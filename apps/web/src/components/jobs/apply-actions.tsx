import { useEffect, useId, useRef, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button.tsx';
import { copy } from '@/copy/index.ts';
import { ApiError, useApi } from '@/lib/api/index.ts';
import { type JobSummary, setStage } from '@/lib/api/jobs.ts';
import { cn } from '@/lib/utils.ts';

const text = copy.matchesPage.apply;

/**
 * Applying, in Matches' job pane (#52 PR C, locked on the issue): **Manual apply** opens the
 * employer's application (its apply page, else the posting) in a new tab, and asks "Did you
 * apply on the employer site?" (the prototype's check): I applied marks the job applied, and it
 * leaves Matches (`onApplied`); Not yet puts the question away. **Auto apply** shows, unavailable,
 * until the browser extension (#54).
 *
 * The question takes the focus when it shows, so it is the first thing met on coming back from
 * the employer's tab. A save that failed says so in the question, and the list is read again
 * (`onFailed`): a job already applied to elsewhere leaves it then.
 */
export function ApplyActions({
  job,
  onApplied,
  onFailed,
}: {
  job: JobSummary;
  /** Saved: the job as the API has it now (applied). */
  onApplied: (job: JobSummary) => void;
  onFailed: () => void;
}) {
  const api = useApi();
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  // What went wrong, and how many times (a new failure is a new alert, read out again).
  const [failure, setFailure] = useState<{ words: string; count: number } | null>(null);
  const manual = useRef<HTMLAnchorElement>(null);
  const question = useRef<HTMLFieldSetElement>(null);
  const ids = { manual: useId(), auto: useId(), askLine: useId() };
  useEffect(() => {
    if (asking) question.current?.focus();
  }, [asking]);
  async function applied() {
    setSaving(true);
    try {
      onApplied(await setStage(api, job.jobId, 'applied', 'new'));
    } catch (error) {
      setSaving(false);
      setFailure((was) => ({
        words: error instanceof ApiError && error.kind === 'offline' ? text.offline : text.failed,
        count: (was?.count ?? 0) + 1,
      }));
      onFailed();
    }
  }
  function notYet() {
    setAsking(false);
    setFailure(null);
    manual.current?.focus();
  }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <a
          ref={manual}
          href={job.applyUrl ?? job.jobUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-describedby={ids.manual}
          // The employer's tab opens; the question waits here for the way back.
          onClick={() => setAsking(true)}
          className={cn(buttonVariants(), 'no-underline')}
        >
          {text.manual}
          <span aria-hidden="true">↗</span>
          <span className="sr-only"> {copy.jobsPage.preview.newTab}</span>
        </a>
        {/* Unavailable, not disabled: it can still be reached, and says why. */}
        <Button variant="outline" aria-disabled aria-describedby={ids.auto}>
          {text.auto}
          <span className="rounded-full bg-paper-deep px-2 py-0.5 text-[0.6875rem]/[1.3] font-[750] tracking-[0.08em] text-ink-soft uppercase">
            {text.soon}
          </span>
        </Button>
      </div>
      <div className="grid gap-1 text-sm text-muted-foreground">
        <p id={ids.manual} className="m-0">
          {text.manualHint}
        </p>
        <p id={ids.auto} className="m-0">
          {text.autoHint}
        </p>
      </div>
      {asking && (
        <div className="rounded-[18px] border border-green-line bg-green-wash p-4">
          <fieldset
            ref={question}
            tabIndex={-1}
            aria-describedby={ids.askLine}
            className="m-0 min-w-0 border-0 p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring focus-visible:outline-solid"
          >
            <legend className="p-0 font-[700] text-ink">{text.ask}</legend>
            <p id={ids.askLine} className="m-0 mt-1 text-sm text-ink-soft">
              {text.askLine}
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Button pending={saving} pendingLabel={text.saving} onClick={() => void applied()}>
                {text.yes}
              </Button>
              <Button variant="outline" aria-disabled={saving} onClick={notYet}>
                {text.no}
              </Button>
            </div>
            {/* Always there, so a failure is read out when it comes. */}
            <p
              key={failure?.count ?? 0}
              role="alert"
              className={failure ? 'm-0 mt-3 text-sm font-[650] text-danger-ink' : 'sr-only'}
            >
              {failure?.words ?? ''}
            </p>
          </fieldset>
        </div>
      )}
    </div>
  );
}
