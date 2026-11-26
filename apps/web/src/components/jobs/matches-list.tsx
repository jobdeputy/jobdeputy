import { useQueryClient } from '@tanstack/react-query';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { ApplyActions } from '@/components/jobs/apply-actions.tsx';
import { FitLabel } from '@/components/jobs/fit-label.tsx';
import { JobPreview } from '@/components/jobs/job-preview.tsx';
import { postedDay, postedTime, whereText } from '@/components/jobs/job-text.ts';
import {
  JOBS_TABLE_SKELETON,
  type JobsColumn,
  JobsTable,
  ROW_BUTTON_CLASS,
  TableEmpty,
} from '@/components/jobs/jobs-table.tsx';
import { SEARCH_TAB } from '@/components/jobs/tabs.ts';
import { SECTION_TITLE_CLASS } from '@/components/section.tsx';
import { LoadFailed } from '@/components/setup/parts.tsx';
import { Button } from '@/components/ui/button.tsx';
import { QueryRegion } from '@/components/ui/query-region.tsx';
import { copy, fill } from '@/copy/index.ts';
import { ApiError, useApi } from '@/lib/api/index.ts';
import {
  companyName,
  fitOf,
  type JobSummary,
  type Matches,
  matchesKey,
  setStage,
  useMatches,
} from '@/lib/api/jobs.ts';
import { followLink } from '@/lib/router.ts';
import { useWide } from '@/lib/use-wide.ts';
import { cn } from '@/lib/utils.ts';

const text = copy.matchesPage.list;
const applyText = copy.matchesPage.apply;

/**
 * What the list says above the table after the job open left it: marked applied here (with
 * Undo), back again after Undo, or gone without this page's doing (applied in another tab, or a
 * crawl closed its posting).
 */
type Notice =
  | {
      kind: 'applied';
      job: JobSummary;
      /** Undo: offered, on its way, failed (`tries` times), or refused (changed elsewhere). */
      undo: 'ready' | 'undoing' | 'failed' | 'changed';
      tries: number;
    }
  | { kind: 'undone'; job: JobSummary }
  | { kind: 'left' };

/**
 * Matches (#52 PR C): every job not applied to yet, in the jobs area's table, best fit first
 * (each column sorts in the browser: every row is loaded). A row opens its job in the pane
 * (JobPreview, as #49 PR D: beside the table on a wide screen, else a view of its own), where
 * the job is applied to (ApplyActions); once marked applied, it leaves the table, and the list
 * says so with Undo. `version` is what the list reflects (useMatches).
 *
 * Focus is never dropped: closing the pane hands it back to the job's row; a job that left
 * hands it to the line saying so (never taken from another job opened meanwhile); a list read
 * again that leaves out what had it, to the heading.
 */
export function MatchesList({
  version,
  progress,
  offline = false,
}: {
  version: string | undefined;
  /**
   * #50: changes while a list run's companies are read (one each time one ends): Matches is
   * read again in place.
   */
  progress?: string | undefined;
  /** The newest crawl's first read is waiting for a connection (the list waits for it). */
  offline?: boolean;
}) {
  const api = useApi();
  const queries = useQueryClient();
  const matches = useMatches(version);
  const { refetch, isFetching } = matches;
  // A company ended: read the list again, once no read is on its way (a read sent before it
  // ended may miss it).
  const lastProgress = useRef(progress);
  const due = useRef(false);
  useEffect(() => {
    if (progress !== lastProgress.current && progress !== undefined) due.current = true;
    lastProgress.current = progress;
    if (!due.current || isFetching) return;
    due.current = false;
    void refetch();
  }, [progress, isFetching, refetch]);
  const wide = useWide();
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // As they are now, for a save that ends after the person moved on.
  const openNow = useRef(openId);
  openNow.current = openId;
  const noticeNow = useRef(notice);
  noticeNow.current = notice;
  const rows = matches.data?.jobs;
  const open = (openId !== null && rows?.find((job) => job.jobId === openId)) || null;
  // The job open left the list without this page's doing (another tab, a crawl): the pane
  // closes and says why.
  const left = openId !== null && rows !== undefined && !open;
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const noticeLine = useRef<HTMLParagraphElement>(null);
  // Whether the next notice takes the focus: not from another job opened meanwhile.
  const noticeTakesFocus = useRef(false);
  useEffect(() => {
    if (!left) return;
    noticeTakesFocus.current = true;
    setOpenId(null);
    setNotice({ kind: 'left' });
  }, [left]);
  useEffect(() => {
    if (!notice || !noticeTakesFocus.current) return;
    noticeTakesFocus.current = false;
    noticeLine.current?.focus();
  }, [notice]);
  // What had the focus in the list: if a list read again leaves it out, the heading takes it
  // (unless a job that left is about to say so: that line takes it).
  const lastFocused = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!rows || left) return;
    const was = lastFocused.current;
    if (was && !was.isConnected && document.activeElement === document.body) {
      lastFocused.current = null;
      heading.current?.focus();
    }
  }, [rows, left]);
  // A screen that narrows with a job open hides the table: focus in it goes to the job's title.
  const tablePart = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!wide && open && tablePart.current?.contains(document.activeElement)) {
      document.getElementById('job-preview-title')?.focus();
    }
  }, [wide, open]);
  function close() {
    const jobId = openId;
    setOpenId(null);
    // Back to the row that opened it, once the table shows again; to the heading if a list read
    // again left it out.
    requestAnimationFrame(() => {
      const row = section.current?.querySelector<HTMLElement>(`[data-job-id="${jobId}"]`);
      (row ?? heading.current)?.focus();
    });
  }
  /** A row: opens its job, or closes it when it is the one open (it toggles). */
  function toggle(job: JobSummary) {
    if (openId === job.jobId) close();
    else {
      setNotice(null);
      setOpenId(job.jobId);
    }
  }
  /**
   * A job out of Matches: marked applied here, or found applied elsewhere (or gone) when this
   * page tried. Out of the table at once, then read again (a read on its way could bring it
   * back). Its pane closes, and the line saying so takes the focus, unless another job was
   * opened meanwhile (that one stays, and keeps it).
   */
  function leave(job: JobSummary, said: Notice) {
    queries.setQueriesData<Matches>({ queryKey: matchesKey }, (was) =>
      was ? { ...was, jobs: was.jobs.filter((each) => each.jobId !== job.jobId) } : was,
    );
    const elsewhere = openNow.current !== null && openNow.current !== job.jobId;
    if (!elsewhere) setOpenId(null);
    noticeTakesFocus.current = !elsewhere;
    setNotice(said);
    void queries.invalidateQueries({ queryKey: matchesKey });
  }
  /** Whether the line still offers this job's Undo (the person may have moved on). */
  function offersUndo(job: JobSummary) {
    const now = noticeNow.current;
    return now?.kind === 'applied' && now.job.jobId === job.jobId;
  }
  async function undo(job: JobSummary) {
    setNotice((was) => (was?.kind === 'applied' ? { ...was, undo: 'undoing' } : was));
    try {
      await setStage(api, job.jobId, 'new', 'applied');
      // Back in its place once the list is read again.
      await queries.invalidateQueries({ queryKey: matchesKey });
      if (!offersUndo(job)) return;
      // Undo went with its line's change: the line takes the focus.
      noticeTakesFocus.current = true;
      setNotice({ kind: 'undone', job });
    } catch (error) {
      // Whatever happened, Matches as it is now (an undo done elsewhere brings the job back).
      void queries.invalidateQueries({ queryKey: matchesKey });
      if (!offersUndo(job)) return;
      const changed =
        error instanceof ApiError && (error.kind === 'conflict' || error.kind === 'not-found');
      // Refused for good: Undo goes, and its line takes the focus.
      noticeTakesFocus.current = changed;
      setNotice((was) =>
        was?.kind === 'applied'
          ? { ...was, undo: changed ? 'changed' : 'failed', tries: was.tries + 1 }
          : was,
      );
    }
  }
  const columns = columnsFor(openId, toggle);
  return (
    <section
      ref={section}
      aria-labelledby="matches-list-title"
      className="grid gap-5"
      onFocus={(event) => {
        lastFocused.current = event.target;
      }}
    >
      <h2
        id="matches-list-title"
        ref={heading}
        tabIndex={-1}
        className={cn(SECTION_TITLE_CLASS, 'outline-none')}
      >
        {text.title}
      </h2>
      {notice && <NoticeLine notice={notice} line={noticeLine} onUndo={undo} />}
      {/* Beside a job's pane the table takes the larger part (its rows stack when narrow). */}
      <div
        className={cn(
          'grid gap-5',
          open && wide && 'grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start',
        )}
      >
        {/* On a narrower screen the job's pane is a view of its own: the table waits behind
            it, hidden (neither seen nor read). */}
        <div ref={tablePart} hidden={open !== null && !wide} className="min-w-0">
          <QueryRegion
            query={{
              data: matches.data,
              isLoading: matches.isLoading || version === undefined,
              isFetching: matches.isFetching,
              isPending: matches.isPending,
              isPaused: matches.isPaused || (version === undefined && offline),
              isError: matches.isError,
            }}
            skeleton={JOBS_TABLE_SKELETON}
            label={text.loading}
            error={
              <LoadFailed
                // A new failure is a new alert, so the same words are read out again.
                key={matches.errorUpdateCount}
                retrying={matches.isFetching}
                error={matches.error}
                message={text.loadFailed}
                retry={text.retry}
                onRetry={() => matches.refetch()}
              />
            }
          >
            {(shown) => (
              <div className="grid gap-3">
                <JobsTable
                  label={text.title}
                  columns={columns}
                  rows={shown.jobs}
                  rowKey={(job) => job.jobId}
                  openKey={open?.jobId}
                  sort={{ key: 'fit', direction: 'descending' }}
                  empty={
                    <TableEmpty
                      title={text.emptyTitle}
                      line={text.emptyLine}
                      // #52: an empty Matches points to Search, where links are given.
                      action={
                        <Button asChild variant="outline">
                          <a
                            href={SEARCH_TAB.path}
                            onClick={(event) => followLink(event, SEARCH_TAB.path)}
                          >
                            {text.toSearch}
                          </a>
                        </Button>
                      }
                    />
                  }
                />
                {shown.truncated && (
                  <p className="m-0 text-sm text-muted-foreground">
                    {fill(text.truncated, { count: String(shown.jobs.length) })}
                  </p>
                )}
              </div>
            )}
          </QueryRegion>
        </div>
        {open && (
          <JobPreview
            key={open.jobId}
            summary={open}
            wide={wide}
            onClose={close}
            actions={
              <ApplyActions
                job={open}
                onApplied={() =>
                  leave(open, { kind: 'applied', job: open, undo: 'ready', tries: 0 })
                }
                onGone={() => leave(open, { kind: 'left' })}
                onFailed={() => void refetch()}
              />
            }
          />
        )}
      </div>
    </section>
  );
}

/** Matches' columns: the job (it opens the pane), its company, where, its fit, and when posted. */
function columnsFor(openId: string | null, onOpen: (job: JobSummary) => void) {
  const columns: JobsColumn<JobSummary>[] = [
    {
      key: 'job',
      label: text.columns.job,
      title: true,
      sortValue: (job) => job.title,
      cell: (job) => (
        <button
          type="button"
          data-job-id={job.jobId}
          aria-controls="job-preview"
          aria-expanded={job.jobId === openId}
          onClick={() => onOpen(job)}
          className={cn(ROW_BUTTON_CLASS, 'font-[680] [overflow-wrap:anywhere]')}
        >
          {job.title}
        </button>
      ),
    },
    {
      key: 'company',
      label: text.columns.company,
      sortValue: (job) => companyName(job),
      cell: (job) => companyName(job),
    },
    {
      key: 'where',
      label: text.columns.where,
      sortValue: (job) => whereText(job) || undefined,
      cell: (job) =>
        whereText(job) || <span className="text-muted-foreground">{text.whereNone}</span>,
    },
    {
      key: 'fit',
      label: text.columns.fit,
      sortValue: (job) => job.relevance?.score,
      sortFirst: 'descending',
      cell: (job) => <FitLabel fit={fitOf(job)} />,
    },
    {
      key: 'posted',
      label: text.columns.posted,
      sortValue: postedTime,
      sortFirst: 'descending',
      numeric: true,
      cell: (job) =>
        postedDay(job) ?? <span className="text-muted-foreground">{text.postedNone}</span>,
    },
  ];
  return columns;
}

/** The line above the table after the open job left it (see Notice). */
function NoticeLine({
  notice,
  line,
  onUndo,
}: {
  notice: Notice;
  line: RefObject<HTMLParagraphElement | null>;
  onUndo: (job: JobSummary) => void;
}) {
  const words =
    notice.kind === 'left'
      ? text.left
      : fill(notice.kind === 'applied' ? applyText.applied : applyText.undone, {
          title: notice.job.title,
          company: companyName(notice.job),
        });
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[18px] border px-4 py-3',
        notice.kind === 'left' ? 'border-line bg-paper' : 'border-green-line bg-green-wash',
      )}
    >
      {/* Takes the focus when it shows, so it is read out (no live region: it would be read twice). */}
      <p
        ref={line}
        tabIndex={-1}
        className="m-0 min-w-0 flex-1 basis-60 text-sm font-[650] text-ink [overflow-wrap:anywhere] outline-none"
      >
        {words}
      </p>
      {notice.kind === 'applied' && notice.undo !== 'changed' && (
        <Button
          variant="outline"
          pending={notice.undo === 'undoing'}
          pendingLabel={applyText.undoing}
          onClick={() => onUndo(notice.job)}
        >
          {applyText.undo}
        </Button>
      )}
      {notice.kind === 'applied' && (
        // Always there while Undo is, so a failed Undo is read out when it comes.
        <p
          key={notice.tries}
          role="alert"
          className={notice.tries > 0 ? 'm-0 w-full text-sm font-[650] text-danger-ink' : 'sr-only'}
        >
          {notice.undo === 'changed'
            ? applyText.undoChanged
            : notice.undo === 'failed'
              ? applyText.undoFailed
              : ''}
        </p>
      )}
    </div>
  );
}
