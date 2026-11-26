import { type InfiniteData, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { dayHere } from '@/components/jobs/job-text.ts';
import {
  JOBS_TABLE_SKELETON,
  type JobsColumn,
  JobsTable,
  TableEmpty,
} from '@/components/jobs/jobs-table.tsx';
import { StageSelect } from '@/components/jobs/stage-select.tsx';
import { HOME_TAB } from '@/components/jobs/tabs.ts';
import { PageIntro } from '@/components/page-intro.tsx';
import { SECTION_TITLE_CLASS } from '@/components/section.tsx';
import { LoadFailed } from '@/components/setup/parts.tsx';
import { Button } from '@/components/ui/button.tsx';
import { QueryRegion } from '@/components/ui/query-region.tsx';
import { copy, fill } from '@/copy/index.ts';
import { ApiError } from '@/lib/api/index.ts';
import {
  applicationsKey,
  companyName,
  type JobSummary,
  stageGone,
  useApplications,
} from '@/lib/api/jobs.ts';
import { followLink } from '@/lib/router.ts';
import { cn } from '@/lib/utils.ts';

const page = copy.applicationsPage;
const text = page.list;

/** The Applications tab (#52 PR D): the jobs applied to, each with its stage. */
export function ApplicationsPage({ pageSize }: { pageSize?: number | undefined }) {
  return (
    <div className="grid w-full max-w-[1120px] content-start gap-8">
      <div className="max-w-[880px]">
        <PageIntro
          id="applications-title"
          eyebrow={page.eyebrow}
          title={page.title}
          intro={page.intro}
        />
      </div>
      <ApplicationsList pageSize={pageSize} />
    </div>
  );
}

/**
 * Every job applied to (#52, locked on the issue), newest applied first, 50 at a time with More
 * applications, in the jobs area's table. Each row's stage is set in place (StageSelect); the
 * order is the server's (a page at a time, so the browser never sorts it).
 *
 * One rule for a row's stage: the newest known wins, by `stageAt` (the server's time of the
 * change). The stages saved here are kept, and a row read from the server shows its own only when
 * it is as new or newer (`newest`), so a read that was on its way during a save never undoes it.
 * Stages saved here also go into the list's cache (by the same rule), so they show on coming
 * back to the tab. A saved stage is said out loud (a status line, once per choice); a failed one in an alert above
 * the table. A job changed elsewhere meanwhile is read again, as it is now. Focus is never dropped: after
 * More applications it moves to the first new job's link, or to the heading when none came and
 * the button went; a list read again that leaves out what had it hands it to the heading.
 */
export function ApplicationsList({ pageSize }: { pageSize?: number | undefined }) {
  const queries = useQueryClient();
  const apps = useApplications(pageSize);
  // The stages saved here, by job: each row shows the newer of its own and this (`newest`).
  const [savedHere, setSavedHere] = useState<ReadonlyMap<string, JobSummary>>(new Map());
  const rows = useMemo(
    () => apps.data?.map((row) => newest(row, savedHere.get(row.jobId))),
    [apps.data, savedHere],
  );
  const { isFetchingNextPage, hasNextPage } = apps;
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // Said once a choice is saved (emptied first, then filled a moment later, so the same words
  // are read out again), and the last failure (a new one is a new alert).
  const [said, setSaid] = useState('');
  const sayLater = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(sayLater.current), []);
  function say(words: string) {
    window.clearTimeout(sayLater.current);
    setSaid('');
    if (words) sayLater.current = window.setTimeout(() => setSaid(words), SAY_AFTER_MS);
  }
  const [failure, setFailure] = useState<{ words: string; count: number } | null>(null);
  // After More applications: where the focus goes once that read ends, however it ended.
  const firstNew = useRef<number | null>(null);
  // Only once a read of the next page has run and ended (not on a render before it starts).
  const readingNext = useRef(false);
  useEffect(() => {
    if (isFetchingNextPage) {
      readingNext.current = true;
      return;
    }
    if (!readingNext.current) return;
    readingNext.current = false;
    const wanted = firstNew.current;
    firstNew.current = null;
    if (wanted === null || !rows) return;
    if (rows[wanted]) {
      section.current?.querySelectorAll<HTMLElement>('tbody a')[wanted]?.focus();
    } else if (!hasNextPage) {
      heading.current?.focus();
    }
  }, [rows, isFetchingNextPage, hasNextPage]);
  // What had the focus in the list: if a read again leaves it out, the heading takes it.
  const lastFocused = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!rows) return;
    const was = lastFocused.current;
    if (was && !was.isConnected && document.activeElement === document.body) {
      lastFocused.current = null;
      heading.current?.focus();
    }
  }, [rows]);
  function named(job: JobSummary) {
    return { title: job.title, company: companyName(job) };
  }
  function saved(job: JobSummary) {
    setSavedHere((was) => new Map(was).set(job.jobId, job));
    queries.setQueriesData<Pages>({ queryKey: applicationsKey }, (was) =>
      was
        ? {
            ...was,
            pages: was.pages.map((each) => ({
              ...each,
              jobs: each.jobs.map((row) => (row.jobId === job.jobId ? newest(row, job) : row)),
            })),
          }
        : was,
    );
  }
  function done(job: JobSummary) {
    setFailure(null);
    const stage = job.status && job.status !== 'new' ? page.stage.names[job.status] : '';
    say(fill(page.stage.saved, { ...named(job), stage }));
  }
  function failed(job: JobSummary, error: unknown) {
    const changed = stageGone(error);
    // Changed elsewhere: Applications as it is now (the job may have left it). Not over a read
    // on its way (More applications): after it, as that read may have started before the change.
    if (changed) {
      const again = { queryKey: applicationsKey };
      void queries
        .invalidateQueries(again, { cancelRefetch: false })
        .then(() => queries.refetchQueries(again, { cancelRefetch: false }));
    }
    const words = changed
      ? page.stage.changed
      : error instanceof ApiError && error.kind === 'offline'
        ? page.stage.offline
        : page.stage.failed;
    say('');
    setFailure((was) => ({ words: fill(words, named(job)), count: (was?.count ?? 0) + 1 }));
  }
  const refreshing = apps.isFetching && !apps.isFetchingNextPage;
  const moreFailed = apps.isFetchNextPageError && !apps.isFetchingNextPage;
  const columns = columnsFor(saved, done, failed);
  return (
    <section
      ref={section}
      aria-labelledby="applications-list-title"
      className="grid gap-5"
      onFocus={(event) => {
        lastFocused.current = event.target;
      }}
    >
      <h2
        id="applications-list-title"
        ref={heading}
        tabIndex={-1}
        className={cn(SECTION_TITLE_CLASS, 'outline-none')}
      >
        {text.title}
      </h2>
      {/* Always there, so a failure is read out when it comes; a new one is a new alert. */}
      <p
        key={failure?.count ?? 0}
        id="applications-failure"
        role="alert"
        className={
          failure
            ? 'm-0 rounded-[18px] border border-line bg-paper px-4 py-3 text-sm font-[650] text-danger-ink [overflow-wrap:anywhere]'
            : 'sr-only'
        }
      >
        {failure?.words ?? ''}
      </p>
      <p id="applications-said" role="status" className="sr-only">
        {said}
      </p>
      <QueryRegion
        // More applications says its own wait on its button, not "Updating…" over the table.
        query={{ ...apps, isFetching: refreshing }}
        skeleton={JOBS_TABLE_SKELETON}
        label={text.loading}
        error={
          <LoadFailed
            key={apps.errorUpdateCount}
            retrying={apps.isFetching}
            error={apps.error}
            message={text.loadFailed}
            retry={text.retry}
            onRetry={() => apps.refetch()}
          />
        }
      >
        {() => (
          <div className="grid gap-5">
            <JobsTable
              label={text.title}
              columns={columns}
              rows={rows ?? []}
              rowKey={(job) => job.jobId}
              empty={
                <TableEmpty
                  title={text.emptyTitle}
                  line={text.emptyLine}
                  // An empty Applications points to Matches, where jobs are applied to.
                  action={
                    <Button asChild variant="outline">
                      <a href={HOME_TAB.path} onClick={(event) => followLink(event, HOME_TAB.path)}>
                        {text.toMatches}
                      </a>
                    </Button>
                  }
                />
              }
            />
            {apps.hasNextPage && (
              <div className="grid justify-items-start">
                <Button
                  variant="outline"
                  pending={apps.isFetchingNextPage}
                  pendingLabel={text.loadingMore}
                  // Not while the pages are read again: the next one would follow the old ones.
                  aria-disabled={refreshing}
                  onClick={() => {
                    if (refreshing) return;
                    firstNew.current = rows?.length ?? 0;
                    void apps.fetchNextPage({ cancelRefetch: false });
                  }}
                >
                  {text.more}
                </Button>
              </div>
            )}
            <p
              key={apps.errorUpdateCount}
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

/** Applications' columns: the job (its posting), its company, its stage, and when applied. */
function columnsFor(
  onSaved: (job: JobSummary) => void,
  onDone: (job: JobSummary) => void,
  onFailed: (job: JobSummary, error: unknown) => void,
): JobsColumn<JobSummary>[] {
  return [
    {
      key: 'job',
      label: text.columns.job,
      title: true,
      cell: (job) => (
        <a
          href={job.jobUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-grid min-h-11 content-center rounded-[4px] font-[680] [overflow-wrap:anywhere] text-ink no-underline outline-none hover:underline hover:decoration-green-line hover:underline-offset-3 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green focus-visible:outline-solid"
        >
          {job.title}
          <span className="sr-only"> {copy.jobsPage.preview.newTab}</span>
        </a>
      ),
    },
    { key: 'company', label: text.columns.company, cell: (job) => companyName(job) },
    {
      key: 'stage',
      label: text.columns.stage,
      cell: (job) => (
        <StageSelect job={job} onSaved={onSaved} onDone={onDone} onFailed={onFailed} />
      ),
    },
    {
      key: 'applied',
      label: text.columns.applied,
      numeric: true,
      cell: (job) => {
        const day = dayHere(job.appliedAt);
        return day ? <time dateTime={job.appliedAt}>{day}</time> : '';
      },
    },
  ];
}

/** How long the status line stays empty before new words (long enough to count as a change). */
const SAY_AFTER_MS = 100;

type Pages = InfiniteData<{ jobs: JobSummary[]; nextCursor?: string }>;

/**
 * A row as shown: the stage saved here when it is as new as the row's own or newer (by
 * `stageAt`, the server's ISO time), else the row as read.
 */
export function newest(row: JobSummary, saved: JobSummary | undefined): JobSummary {
  if (!saved || (saved.stageAt ?? '') < (row.stageAt ?? '')) return row;
  return {
    ...row,
    ...(saved.status ? { status: saved.status } : {}),
    ...(saved.stageAt ? { stageAt: saved.stageAt } : {}),
  };
}
