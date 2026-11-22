import { useEffect, useId, useRef } from 'react';
import { CARD_CLASS, SECTION_TITLE_CLASS } from '@/components/section.tsx';
import { LoadFailed } from '@/components/setup/parts.tsx';
import { Button } from '@/components/ui/button.tsx';
import { QueryRegion } from '@/components/ui/query-region.tsx';
import { copy, plural } from '@/copy/index.ts';
import {
  type Company,
  companyName,
  type Fit,
  fitOf,
  type JobSummary,
  useCompanies,
} from '@/lib/api/companies.ts';
import { cn } from '@/lib/utils.ts';

const text = copy.jobsPage.companies;

/**
 * The person's companies (#49 PR C), the one with the best job first, each with its best jobs
 * ranked (at most 3 by default), a page of 10 companies at a time. Each job shows its fit (the
 * prototype's tone label: a coloured square repeating the words), where it is, and opens the
 * posting on its own site. `version` is the list's version (see useCompanies).
 *
 * Focus is never dropped: after More companies it moves to the first new company; if a list read
 * again leaves out what had the focus, it moves to the list's heading.
 */
export function CompanyList({
  version,
  offline = false,
}: {
  version: string | undefined;
  /** The newest crawl's first read is waiting for a connection (the list waits for it). */
  offline?: boolean;
}) {
  const companies = useCompanies(version);
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
    if (wanted !== null && list && list.length > wanted) {
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
                    <CompanyCard company={company} />
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
    </section>
  );
}

function CompanyCard({ company }: { company: Company }) {
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
            <JobRow job={job} />
          </li>
        ))}
      </ol>
    </article>
  );
}

const TONES: Record<Fit, string> = {
  strong: 'before:bg-green',
  good: 'before:bg-blue',
  stretch: 'before:bg-quiet',
  unscored: 'before:border before:border-line-strong before:bg-transparent',
};

function JobRow({ job }: { job: JobSummary }) {
  const fit = fitOf(job);
  const workplace = job.workplace
    ? ((text.workplace as Record<string, string>)[job.workplace] ?? null)
    : null;
  const where = [job.locations.map((place) => place.text).join(' · '), workplace]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="grid gap-1 py-3">
      <a
        href={job.jobUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="w-fit text-[0.9375rem] font-[680] text-ink underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
      >
        {job.title}
        <span className="sr-only"> {text.opensNewTab}</span>
      </a>
      <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-muted-foreground">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 font-[650] whitespace-nowrap text-ink-soft before:size-2.5 before:shrink-0 before:rounded-[3px] before:content-[""]',
            TONES[fit],
          )}
        >
          {text.fit[fit]}
        </span>
        {where && <span>{where}</span>}
      </p>
    </div>
  );
}
