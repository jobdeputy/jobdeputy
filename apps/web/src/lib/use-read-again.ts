import { useEffect, useRef } from 'react';

/**
 * Reads a query's loaded pages again each time `change` changes (to a defined value), once no
 * read of it is on its way: a read sent before the change may miss it, and one on its way (More,
 * say) is never cancelled. The first value is the query's own first read, not a change; with
 * `fromKnown`, so is the first defined one (`undefined` then meaning "not known yet").
 */
export function useReadAgain(
  change: string | undefined,
  { isFetching, refetch }: { isFetching: boolean; refetch: () => unknown },
  { fromKnown = false }: { fromKnown?: boolean } = {},
): void {
  const last = useRef(change);
  const known = useRef(change !== undefined);
  const due = useRef(false);
  useEffect(() => {
    if (change !== last.current && change !== undefined) {
      if (known.current || !fromKnown) due.current = true;
      known.current = true;
    }
    last.current = change;
    if (!due.current || isFetching) return;
    due.current = false;
    void refetch();
  }, [change, isFetching, refetch, fromKnown]);
}
