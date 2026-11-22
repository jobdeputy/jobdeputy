import { useEffect, useRef } from 'react';
import { FitLabel } from '@/components/jobs/fit-label.tsx';
import { whereText } from '@/components/jobs/job-text.ts';
import { CARD_CLASS } from '@/components/section.tsx';
import { LoadFailed } from '@/components/setup/parts.tsx';
import { Button, buttonVariants } from '@/components/ui/button.tsx';
import { QueryRegion } from '@/components/ui/query-region.tsx';
import { copy, fill } from '@/copy/index.ts';
import { companyName, fitOf, type JobSummary } from '@/lib/api/companies.ts';
import { ApiError } from '@/lib/api/index.ts';
import { type Job, useJob } from '@/lib/api/jobs.ts';
import { cn } from '@/lib/utils.ts';

const text = copy.jobsPage.preview;

/**
 * The job open beside the list (#49 PR D, the prototype's preview pane): what it is, its fit and
 * score, why it fits (the AI's reasons), then the posting's own text, read when it opens. Beside
 * the list on a wide screen; on a narrower one it is a view of its own, with a way back. Its
 * title takes the focus when it opens, so the change is announced; closing hands the focus back
 * (the caller's job, to the row that opened it).
 */
export function JobPreview({
  summary,
  wide,
  onClose,
}: {
  /** The job as the list has it: shown at once while the rest is read. */
  summary: JobSummary;
  /** Beside the list (a Close button), or a view of its own (Back to your companies). */
  wide: boolean;
  onClose: () => void;
}) {
  // `summary` is the job as the list has it now (read again when a crawl's work ends); the job read
  // here only adds the posting's text, and only when the board shared one (the list says so).
  const job = useJob(summary.hasDescription === false ? null : summary.jobId);
  const title = useRef<HTMLHeadingElement>(null);
  // Mounted afresh for each job (the list keys it by its ID).
  useEffect(() => {
    title.current?.focus();
  }, []);
  const fit = fitOf(summary);
  const where = whereText(summary);
  return (
    <section
      id="job-preview"
      aria-labelledby="job-preview-title"
      className={cn(
        CARD_CLASS,
        'grid content-start gap-6',
        // Beside the list it stays in view, and scrolls on its own when taller than the window.
        wide && 'xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:overflow-y-auto',
      )}
    >
      <div className="flex flex-wrap-reverse items-start justify-between gap-3">
        <p className="m-0 text-xs font-[750] tracking-[0.12em] text-muted-foreground uppercase">
          {text.label}
        </p>
        {/* One button, its words by the layout, so a screen that changes width keeps its focus. */}
        <Button variant="outline" onClick={onClose}>
          {wide ? (
            text.close
          ) : (
            <>
              <span aria-hidden="true">←</span> {text.back}
            </>
          )}
        </Button>
      </div>
      <header className="grid gap-2">
        <h2
          id="job-preview-title"
          ref={title}
          tabIndex={-1}
          className="m-0 font-display text-[clamp(1.5rem,4vw,2rem)] leading-tight font-medium tracking-[-0.03em] text-balance [overflow-wrap:anywhere] outline-none"
        >
          {summary.title}
        </h2>
        <p className="m-0 text-sm text-muted-foreground">
          {[companyName(summary), where, posted(summary)].filter(Boolean).join(' · ')}
        </p>
      </header>
      <div className="grid gap-1">
        <FitLabel fit={fit} />
        {summary.relevance && (
          <p className="m-0 text-sm text-muted-foreground">
            {fill(text.score, { score: String(summary.relevance.score) })}
          </p>
        )}
      </div>
      <section aria-labelledby="job-why-title" className="grid gap-3">
        <h3 id="job-why-title" className="m-0 text-base font-[700]">
          {text.whyTitle}
        </h3>
        {summary.relevance?.reasons.length ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            {summary.relevance.reasons.map((reason, index) => (
              <li
                // The AI's reasons never change order; two can read the same.
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, possibly with repeats.
                key={index}
                className="relative ps-5 text-sm [overflow-wrap:anywhere] before:absolute before:start-1 before:top-[0.55em] before:size-1.5 before:rounded-full before:bg-green before:content-['']"
              >
                {reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-sm text-muted-foreground">
            {summary.relevance ? text.whyNoReasons : text.whyNone}
          </p>
        )}
      </section>
      <section aria-labelledby="job-posting-title" className="grid gap-3">
        <h3 id="job-posting-title" className="m-0 text-base font-[700]">
          {text.postingTitle}
        </h3>
        {summary.hasDescription === false ? (
          <p className="m-0 text-sm text-muted-foreground">{text.postingNone}</p>
        ) : (
          <QueryRegion
            query={job}
            skeleton={{ kind: 'block', rows: 3 }}
            label={text.loading}
            error={
              // A job taken down since the list was read: trying again can't help.
              job.error instanceof ApiError && job.error.kind === 'not-found' ? (
                <p role="alert" className="m-0 text-sm text-muted-foreground">
                  {text.gone}
                </p>
              ) : (
                <LoadFailed
                  key={job.errorUpdateCount}
                  error={job.error}
                  message={text.loadFailed}
                  retry={text.retry}
                  retrying={job.isFetching}
                  onRetry={() => job.refetch()}
                />
              )
            }
          >
            {(full) => <Posting job={full} />}
          </QueryRegion>
        )}
      </section>
      <div>
        <a
          href={summary.jobUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants(), 'no-underline')}
        >
          {text.openPosting}
          <span className="sr-only"> {text.newTab}</span>
        </a>
      </div>
    </section>
  );
}

/** The posting's own words: plain text as text (never markup), its lines kept. */
function Posting({ job }: { job: Job }) {
  if (job.description === undefined) {
    return <p className="m-0 text-sm text-muted-foreground">{text.postingNone}</p>;
  }
  return (
    <div className="grid gap-2">
      <p className="m-0 text-sm whitespace-pre-line text-ink-soft [overflow-wrap:anywhere]">
        {job.description}
      </p>
      {job.descriptionTruncated && (
        <p className="m-0 text-sm text-muted-foreground">{text.postingCut}</p>
      )}
    </div>
  );
}

/** Dates in the copy's language: one for a date-only posting (kept as midnight UTC), one local. */
const DAY_UTC = new Intl.DateTimeFormat(copy.locale, { dateStyle: 'medium', timeZone: 'UTC' });
const DAY_HERE = new Intl.DateTimeFormat(copy.locale, { dateStyle: 'medium' });

/**
 * "Posted Nov 3, 2026", when the board said. A board that gives only a day is kept as midnight
 * UTC, so that is read in UTC (else it would be the day before here); a real time is read here.
 */
function posted(job: Pick<JobSummary, 'postedAt'>): string | null {
  const at = job.postedAt ? new Date(job.postedAt) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  const dateOnly =
    at.getUTCHours() === 0 &&
    at.getUTCMinutes() === 0 &&
    at.getUTCSeconds() === 0 &&
    at.getUTCMilliseconds() === 0;
  return fill(text.posted, { date: (dateOnly ? DAY_UTC : DAY_HERE).format(at) });
}
