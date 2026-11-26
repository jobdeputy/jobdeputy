import { useEffect, useRef } from 'react';
import {
  JOBS_TABLE_SKELETON,
  type JobsColumn,
  JobsTable,
  TableEmpty,
} from '@/components/jobs/jobs-table.tsx';
import { SECTION_TITLE_CLASS } from '@/components/section.tsx';
import { LoadFailed } from '@/components/setup/parts.tsx';
import { Button } from '@/components/ui/button.tsx';
import { QueryRegion } from '@/components/ui/query-region.tsx';
import { copy } from '@/copy/index.ts';
import { type Crawl, crawlName, type RunState, runState, useRuns } from '@/lib/api/crawls.ts';
import { useReadAgain } from '@/lib/use-read-again.ts';
import { cn } from '@/lib/utils.ts';

const text = copy.searchPage.runs;

/**
 * Search's run history (#52): every link given, newest first, 20 at a time with More searches,
 * in the jobs area's table. The newest run's row is the crawl the tab follows (`latest`), so it
 * keeps up as it is read with no read of the history; the history is read again only when a new
 * run is given (here or in another tab).
 *
 * Focus is never dropped: after More searches it moves to the first new run's link.
 */
export function RunHistory({ latest }: { latest: Crawl | null | undefined }) {
  const runs = useRuns();
  // Undefined until the newest run is known: knowing it is no reason to read the history again.
  useReadAgain(latest === undefined ? undefined : (latest?.crawlId ?? 'none'), runs, {
    fromKnown: true,
  });
  const section = useRef<HTMLElement>(null);
  // After More searches: the first new run takes the focus, once, when that read ends however
  // it ended (rows, no rows, or failed); never later.
  const firstNew = useRef<number | null>(null);
  const rows = runs.data;
  const { isFetchingNextPage } = runs;
  useEffect(() => {
    if (isFetchingNextPage) return;
    const wanted = firstNew.current;
    firstNew.current = null;
    if (wanted === null || !rows || rows.length <= wanted) return;
    section.current?.querySelectorAll<HTMLElement>('tbody a')[wanted]?.focus();
  }, [rows, isFetchingNextPage]);
  const refreshing = runs.isFetching && !runs.isFetchingNextPage;
  const moreFailed = runs.isFetchNextPageError && !runs.isFetchingNextPage;
  return (
    <section ref={section} aria-labelledby="runs-title" className="grid gap-5">
      <h2 id="runs-title" className={SECTION_TITLE_CLASS}>
        {text.title}
      </h2>
      <QueryRegion
        // More searches says its own wait on its button, not "Updating…" over the whole table.
        query={{ ...runs, isFetching: refreshing }}
        skeleton={JOBS_TABLE_SKELETON}
        label={text.loading}
        error={
          <LoadFailed
            // A new failure is a new alert, so the same words are read out again.
            key={runs.errorUpdateCount}
            retrying={runs.isFetching}
            error={runs.error}
            message={text.loadFailed}
            retry={text.retry}
            onRetry={() => runs.refetch()}
          />
        }
      >
        {(shown) => (
          <div className="grid gap-5">
            <JobsTable
              label={text.title}
              columns={COLUMNS}
              rows={
                latest ? shown.map((run) => (run.crawlId === latest.crawlId ? latest : run)) : shown
              }
              rowKey={(run) => run.crawlId}
              empty={<TableEmpty title={text.emptyTitle} line={text.emptyLine} />}
            />
            {runs.hasNextPage && (
              <div className="grid justify-items-start">
                <Button
                  variant="outline"
                  pending={runs.isFetchingNextPage}
                  pendingLabel={text.loadingMore}
                  // Not while the pages are read again: the next one would follow the old ones.
                  // aria-disabled, not disabled: a focused button keeps the focus.
                  aria-disabled={refreshing}
                  onClick={() => {
                    firstNew.current = shown.length;
                    void runs.fetchNextPage({ cancelRefetch: false });
                  }}
                >
                  {text.more}
                </Button>
              </div>
            )}
            {/* Always there, so a failed More searches is read out when it comes. */}
            <p
              key={runs.errorUpdateCount}
              role="alert"
              className={moreFailed ? 'm-0 text-sm font-[650] text-danger-ink' : 'sr-only'}
            >
              {moreFailed ? text.moreFailed : ''}
            </p>
          </div>
        )}
      </QueryRegion>
    </section>
  );
}

const WHEN = new Intl.DateTimeFormat(copy.locale, { dateStyle: 'medium', timeStyle: 'short' });

/** The tone of a run's state: at work green, trouble red, done plain. */
const STATE_CLASS: Record<RunState, string> = {
  waiting: 'text-green-ink',
  reading: 'text-green-ink',
  scoring: 'text-green-ink',
  stalled: 'text-danger-ink',
  failed: 'text-danger-ink',
  done: 'text-ink',
};

const COLUMNS: JobsColumn<Crawl>[] = [
  {
    key: 'link',
    label: text.columns.link,
    title: true,
    cell: (run) => (
      <a
        href={run.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-grid min-h-11 content-center rounded-[4px] break-all text-ink no-underline outline-none hover:underline hover:decoration-green-line hover:underline-offset-3 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green focus-visible:outline-solid"
      >
        {crawlName(run)}
        <span className="text-xs font-normal text-muted-foreground">
          {run.kind === 'list' ? text.kind.list : text.kind.page}
          <span className="sr-only"> {copy.jobsPage.preview.newTab}</span>
        </span>
      </a>
    ),
  },
  {
    key: 'started',
    label: text.columns.started,
    cell: (run) => {
      const at = new Date(run.createdAt);
      return Number.isNaN(at.getTime()) ? (
        ''
      ) : (
        <time dateTime={run.createdAt}>{WHEN.format(at)}</time>
      );
    },
  },
  {
    key: 'status',
    label: text.columns.status,
    cell: (run) => {
      const state = runState(run);
      return <span className={cn('font-[650]', STATE_CLASS[state])}>{text.states[state]}</span>;
    },
  },
  {
    key: 'companies',
    label: text.columns.companies,
    numeric: true,
    cell: (run) => count(run, companiesRead(run)),
  },
  {
    key: 'jobs',
    label: text.columns.jobs,
    numeric: true,
    cell: (run) => count(run, run.stats?.jobsFound),
  },
];

/** How many companies a run read: a list's company crawls that succeeded; a page's own one. */
function companiesRead(run: Crawl): number | undefined {
  if (run.kind === 'list') return run.stats?.companies?.succeeded;
  return run.status === 'succeeded' ? 1 : undefined;
}

/** A count; none when the run ended without one; a dash (read "Not known yet") while at work. */
function count(run: Crawl, value: number | undefined) {
  if (value !== undefined) return value.toLocaleString(copy.locale);
  const state = runState(run);
  if (state === 'failed' || state === 'done') return (0).toLocaleString(copy.locale);
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{text.none}</span>
    </>
  );
}
