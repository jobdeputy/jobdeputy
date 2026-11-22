import { useEffect, useId, useRef, useState } from 'react';
import { FitLabel } from '@/components/jobs/fit-label.tsx';
import { JobPreview } from '@/components/jobs/job-preview.tsx';
import { whereText } from '@/components/jobs/job-text.ts';
import { CARD_CLASS, SECTION_TITLE_CLASS } from '@/components/section.tsx';
import { LoadFailed } from '@/components/setup/parts.tsx';
import { Button } from '@/components/ui/button.tsx';
import { QueryRegion } from '@/components/ui/query-region.tsx';
import { copy, plural } from '@/copy/index.ts';
import {
  type Company,
  companyName,
  fitOf,
  type JobSummary,
  useCompanies,
} from '@/lib/api/companies.ts';
import { useWide } from '@/lib/use-wide.ts';
import { cn } from '@/lib/utils.ts';

const text = copy.jobsPage.companies;

/**
 * The person's companies (#49 PR C), the one with the best job first, each with its best jobs
 * ranked (at most 3 by default), a page of 10 companies at a time. Each job shows its fit (the
 * prototype's tone label: a coloured square repeating the words) and where it is; its title opens
 * it in the preview (JobPreview), and closes it again. `version` is the list's version (see useCompanies).
 *
 * Focus is never dropped: after More companies it moves to the first new company; if a list read
 * again leaves out what had the focus, it moves to the list's heading.
 */
export function CompanyList({
  version,
  progress,
  offline = false,
}: {
  version: string | undefined;
  /**
   * #50: changes while a list run's companies are read (one each time one ends): the companies
   * already loaded are read again in place, so pages opened with More companies stay.
   */
  progress?: string | undefined;
  /** The newest crawl's first read is waiting for a connection (the list waits for it). */
  offline?: boolean;
}) {
  const companies = useCompanies(version);
  const { refetch } = companies;
  const lastProgress = useRef(progress);
  useEffect(() => {
    if (progress === lastProgress.current) return;
    lastProgress.current = progress;
    if (progress !== undefined) void refetch();
  }, [progress, refetch]);
  const wide = useWide();
  // The job open in the preview: as the list has it now (a list read again may have scored it),
  // else as it was when it was opened (a read that left it out).
  const [opened, setOpened] = useState<JobSummary | null>(null);
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // What had the focus in the list: if a list read again leaves it out, the heading takes it.
  const lastFocused = useRef<HTMLElement | null>(null);
  // After More companies: the first new company takes the focus (once, whatever came back).
  const firstNew = useRef<number | null>(null);
  const list = companies.data;
  useEffect(() => {
    const wanted = firstNew.current;
    firstNew.current = null;
    // Not away from a job opened meanwhile.
    const inPreview = document.getElementById('job-preview')?.contains(document.activeElement);
    if (wanted !== null && !inPreview && list && list.length > wanted) {
      section.current?.querySelectorAll<HTMLElement>('article h3')[wanted]?.focus();
      return;
    }
    const was = lastFocused.current;
    if (was && !was.isConnected && document.activeElement === document.body) {
      lastFocused.current = null;
      heading.current?.focus();
    }
  }, [list]);
  // A More companies that failed takes nothing in: its marker goes.
  useEffect(() => {
    if (companies.isFetchNextPageError) firstNew.current = null;
  }, [companies.isFetchNextPageError]);
  const open =
    opened &&
    (list?.flatMap((company) => company.jobs).find((job) => job.jobId === opened.jobId) ?? opened);
  // A screen that narrows with a job open hides the list: focus in it goes to the job's title.
  const listPart = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!wide && opened && listPart.current?.contains(document.activeElement)) {
      document.getElementById('job-preview-title')?.focus();
    }
  }, [wide, opened]);
  function close() {
    const jobId = opened?.jobId;
    setOpened(null);
    // Back to the row that opened it, once the list shows again; to the list's heading if a
    // list read again left it out.
    requestAnimationFrame(() => {
      const row = section.current?.querySelector<HTMLElement>(`[data-job-id="${jobId}"]`);
      (row ?? heading.current)?.focus();
    });
  }
  /** A row's title: opens its job, or closes it when it is the one open (it toggles). */
  function toggle(job: JobSummary) {
    if (opened?.jobId === job.jobId) close();
    else {
      // A More companies on its way no longer takes the focus: the job does.
      firstNew.current = null;
      setOpened(job);
    }
  }
  const refreshing = companies.isFetching && !companies.isFetchingNextPage;
  // Gone while it is tried again.
  const moreFailed = companies.isFetchNextPageError && !companies.isFetchingNextPage;
  return (
    <section
      ref={section}
      aria-labelledby="companies-title"
      className="grid gap-5"
      onFocus={(event) => {
        lastFocused.current = event.target;
      }}
    >
      <h2
        id="companies-title"
        ref={heading}
        tabIndex={-1}
        className={cn(SECTION_TITLE_CLASS, 'outline-none')}
      >
        {text.title}
      </h2>
      {/* The list keeps the page's measure; beside a job's preview, it takes half of a wider one. */}
      <div className={cn('grid gap-5', open && wide ? 'grid-cols-2 items-start' : 'max-w-[880px]')}>
        {/* On a narrower screen the job's preview is a view of its own: the list waits behind
            it, hidden (neither seen nor read). */}
        <div ref={listPart} hidden={open !== null && !wide} className="min-w-0">
          <QueryRegion
            // Only what the region reads; More companies says its own wait on its button, not
            // "Updating…" over the whole list.
            query={{
              data: list,
              isLoading: companies.isLoading || version === undefined,
              isFetching: refreshing,
              isPending: companies.isPending,
              isPaused: companies.isPaused || (version === undefined && offline),
              isError: companies.isError,
            }}
            skeleton={{ kind: 'block', rows: 3 }}
            label={text.loading}
            error={
              <LoadFailed
                // A new failure is a new alert, so the same words are read out again.
                key={companies.errorUpdateCount}
                retrying={companies.isFetching}
                error={companies.error}
                message={text.loadFailed}
                retry={text.retry}
                onRetry={() => companies.refetch()}
              />
            }
          >
            {(shown) =>
              shown.length === 0 ? (
                <div className="grid gap-1 rounded-[24px] border border-dashed border-line px-[21px] py-[34px] text-center">
                  <p className="m-0 font-[700]">{text.emptyTitle}</p>
                  <p className="m-0 text-sm text-muted-foreground">{text.emptyLine}</p>
                </div>
              ) : (
                <div className="grid gap-5">
                  <ol aria-labelledby="companies-title" className="m-0 grid list-none gap-5 p-0">
                    {shown.map((company) => (
                      <li key={company.companyKey}>
                        <CompanyCard company={company} openJobId={open?.jobId} onOpen={toggle} />
                      </li>
                    ))}
                  </ol>
                  {companies.hasNextPage && (
                    <div className="grid justify-items-start gap-3">
                      <Button
                        variant="outline"
                        pending={companies.isFetchingNextPage}
                        pendingLabel={text.loadingMore}
                        // Not while the list is read again from the start: its next page would come
                        // from the old first one.
                        // aria-disabled, not disabled: a focused button keeps the focus.
                        aria-disabled={refreshing || companies.isPlaceholderData}
                        onClick={() => {
                          firstNew.current = shown.length;
                          void companies.fetchNextPage({ cancelRefetch: false });
                        }}
                      >
                        {text.more}
                      </Button>
                    </div>
                  )}
                  {/* Always there, so a failed More companies is read out when it comes. */}
                  <p
                    // A new failure is a new alert, so the same words are read out again.
                    key={companies.errorUpdateCount}
                    role="alert"
                    className={moreFailed ? 'm-0 text-sm font-[650] text-danger-ink' : 'sr-only'}
                  >
                    {moreFailed ? text.moreFailed : ''}
                  </p>
                </div>
              )
            }
          </QueryRegion>
        </div>
        {open && <JobPreview key={open.jobId} summary={open} wide={wide} onClose={close} />}
      </div>
    </section>
  );
}

function CompanyCard({
  company,
  openJobId,
  onOpen,
}: {
  company: Company;
  openJobId: string | undefined;
  onOpen: (job: JobSummary) => void;
}) {
  const name = companyName(company);
  const id = useId();
  return (
    <article aria-labelledby={id} className={CARD_CLASS}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3
          id={id}
          tabIndex={-1}
          className="m-0 text-lg font-[700] tracking-[-0.01em] outline-none"
        >
          {name}
        </h3>
        <p className="m-0 text-[0.8125rem] text-muted-foreground">
          {plural(text.roles, company.jobs.length)}
        </p>
      </header>
      <ol aria-labelledby={id} className="m-0 mt-3 grid list-none p-0">
        {company.jobs.map((job) => (
          <li key={job.jobId} className="border-t border-line-soft first:border-t-0">
            <JobRow job={job} isOpen={job.jobId === openJobId} onOpen={() => onOpen(job)} />
          </li>
        ))}
      </ol>
    </article>
  );
}

/**
 * A job in its company's list: its title opens it in the preview (the prototype's row; the open
 * one is marked with a green edge), then its fit and where.
 */
function JobRow({ job, isOpen, onOpen }: { job: JobSummary; isOpen: boolean; onOpen: () => void }) {
  const where = whereText(job);
  return (
    <div
      className={cn(
        'grid gap-1 py-3',
        isOpen &&
          '-ms-3 border-s-[3px] border-s-green ps-[9px] forced-colors:outline-1 forced-colors:outline-solid',
      )}
    >
      <button
        type="button"
        data-job-id={job.jobId}
        aria-controls="job-preview"
        aria-expanded={isOpen}
        onClick={onOpen}
        className="w-fit cursor-pointer border-0 bg-transparent p-0 text-start text-[0.9375rem] font-[680] text-ink underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
      >
        {job.title}
      </button>
      <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-muted-foreground">
        <FitLabel fit={fitOf(job)} />
        {where && <span>{where}</span>}
      </p>
    </div>
  );
}
