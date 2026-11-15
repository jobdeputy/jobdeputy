import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Skeleton, type SkeletonKind } from '@/components/ui/skeleton.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { copy, fill } from '@/copy/index.ts';
import { useDelayedPending, useLongWait } from '@/lib/use-delayed-pending.ts';
import { cn } from '@/lib/utils.ts';

/** What QueryRegion reads from a TanStack Query result: pass the query itself. */
export type QueryState<T> = Pick<
  UseQueryResult<T>,
  'data' | 'isLoading' | 'isFetching' | 'isPending' | 'isPaused' | 'isError'
>;

/**
 * A screen region filled by a query (#17), with its loading states built in, so a screen never
 * wires its own. Pass the query, the skeleton that stands in for its data, and what is loading.
 *
 * - **First load** (also one TanStack has paused, offline, until the network returns): its
 *   content is `aria-busy`, holding the skeleton's size but blank; after 300 ms the skeleton shows
 *   and the polite status line says `label` ("Loading your matches"). Once shown, it stays at
 *   least 500 ms (useDelayedPending). After 8 s of a running load, "Still working…" shows on a
 *   chip over the skeleton and is read out with the label.
 * - **Refreshing** (data on screen, a newer copy loading): the data stays, readable and not busy,
 *   and after 300 ms a quiet "Updating…" sits at its top right, letting clicks through. Nothing is
 *   read out: a refetch on every window focus would be noise.
 * - **Waiting offline** (a first load TanStack paused until the network returns): after 300 ms
 *   "Waiting for a connection…" sits on the skeleton and is read out with the label.
 * - **Failed with no data:** `error` shows (the error component's job, not this one's).
 */
export function QueryRegion<T>({
  query,
  skeleton,
  label,
  error,
  className,
  children,
}: {
  query: QueryState<T>;
  skeleton: { kind?: SkeletonKind; rows?: number };
  /** Said once the skeleton shows: what the region is waiting for. */
  label: string;
  /** Shown when the first load fails. Required, so no screen forgets it (null opts out). */
  error: ReactNode;
  className?: string;
  children: (data: T) => ReactNode;
}) {
  const loading = query.isLoading || (query.isPending && query.isPaused);
  const refreshing = !loading && query.isFetching && query.data !== undefined;
  const skeletonShown = useDelayedPending(loading);
  const updatingShown = useDelayedPending(refreshing);
  // Counted over the whole first load (offline spells too); only a load that is actually running
  // is "still working": a paused one is waiting for the network.
  const longLoad = useLongWait(loading) && skeletonShown && !query.isPaused;
  // The skeleton holds its 500 ms even when the data comes sooner, so it never flashes.
  const holding = loading || skeletonShown;
  // A first load paused offline waits for the network: say so, on screen and read out.
  const offline = skeletonShown && loading && query.isPaused;
  // "Updating…" only ever sits on data: never over a skeleton, an error, or nothing.
  const updatingVisible = updatingShown && !holding && query.data !== undefined;

  let body: ReactNode = null;
  if (holding) {
    body = <Skeleton {...skeleton} className={cn(!skeletonShown && 'invisible')} />;
  } else if (query.data !== undefined) {
    body = children(query.data);
  } else if (query.isError) {
    body = error;
  }

  return (
    <div
      data-slot="query-region"
      data-state={skeletonShown ? 'loading' : updatingVisible ? 'refreshing' : undefined}
      className={cn('relative', className)}
    >
      {/* Mounted empty with the region, so the label is read when it arrives; outside the busy
          content, whose updates screen readers may hold back until it is done. */}
      <p role="status" className="sr-only">
        {offline
          ? fill(copy.loading.offlineLoading, { label })
          : longLoad
            ? fill(copy.loading.stillLoading, { label })
            : skeletonShown
              ? label
              : ''}
      </p>
      {updatingVisible && (
        <p
          aria-hidden="true"
          className="pointer-events-none absolute top-0 right-0 z-1 m-0 inline-flex items-center gap-1.5 rounded-full bg-surface-strong px-2 py-0.5 text-xs text-muted-foreground"
        >
          <Spinner /> {copy.loading.refreshing}
        </p>
      )}
      <div data-slot="query-region-content" aria-busy={holding || undefined}>
        {body}
      </div>
      {(longLoad || offline) && (
        <p
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 m-0 w-max max-w-[calc(100%-1rem)] -translate-1/2 rounded-[13px] bg-surface-strong px-3 py-1 text-center text-sm text-muted-foreground shadow-panel"
        >
          {offline ? copy.loading.offline : copy.loading.stillWorking}
        </p>
      )}
    </div>
  );
}
