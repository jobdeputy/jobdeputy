import { useEffect, useId, useRef, useState } from 'react';
import { dayHere } from '@/components/jobs/job-text.ts';
import { Button, buttonVariants } from '@/components/ui/button.tsx';
import { copy, fill, plural } from '@/copy/index.ts';
import { ApiError, useApi } from '@/lib/api/index.ts';
import {
  type Cooldown,
  companyName,
  coolingDown,
  type JobSummary,
  setStage,
  stageGone,
} from '@/lib/api/jobs.ts';
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
 * the employer's tab. A job found changed elsewhere (409 `stage-changed`: applied in another
 * tab; it can only have moved on) or gone (404) leaves Matches (`onGone`). Any other failure is said in the
 * question, and the list is read again (`onFailed`).
 *
 * #52 PR E (0013): while the job's company cools down (`coolingDownUntil`), Manual apply is
 * unavailable, saying until when. An "I applied" refused for that (the list was out of date) says
 * so, and the list read again turns Manual apply off: the question goes, and if it had the focus,
 * Manual apply takes it (its description says why and until when).
 */
export function ApplyActions({
  job,
  cooldown,
  onApplied,
  onGone,
  onFailed,
}: {
  job: JobSummary;
  /** Matches' cooldown rule, to say it. */
  cooldown?: Cooldown;
  /** Saved: the job as the API has it now (applied). */
  onApplied: (job: JobSummary) => void;
  /** Not in Matches any more: applied to elsewhere, or taken down. */
  onGone: () => void;
  onFailed: () => void;
}) {
  const api = useApi();
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  // What went wrong, and how many times (a new failure is a new alert, read out again).
  const [failure, setFailure] = useState<{ words: string; count: number } | null>(null);
  const manual = useRef<HTMLAnchorElement>(null);
  const manualOff = useRef<HTMLButtonElement>(null);
  const question = useRef<HTMLFieldSetElement>(null);
  const ids = { manual: useId(), auto: useId(), askLine: useId() };
  const until = job.coolingDownUntil;
  useEffect(() => {
    if (asking) question.current?.focus();
  }, [asking]);
  // Cooling down now while asking (the list read again): nothing to ask any more.
  useEffect(() => {
    if (until === undefined || !asking) return;
    const active = document.activeElement;
    const hadFocus =
      question.current?.contains(active) === true || active === null || active === document.body;
    setAsking(false);
    setSaving(false);
    setFailure(null);
    if (hadFocus) manualOff.current?.focus();
  }, [until, asking]);
  async function applied() {
    setSaving(true);
    try {
      onApplied(await setStage(api, job.jobId, 'applied', 'new'));
    } catch (error) {
      if (stageGone(error)) {
        onGone();
        return;
      }
      setSaving(false);
      setFailure((was) => ({
        words: coolingDown(error)
          ? text.coolingRefused
          : error instanceof ApiError && error.kind === 'offline'
            ? text.offline
            : text.failed,
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
        {until !== undefined ? (
          // Unavailable, not disabled: it can still be reached, and says why and until when.
          <Button ref={manualOff} aria-disabled aria-describedby={ids.manual}>
            {text.manual}
          </Button>
        ) : (
          <a
            ref={manual}
            href={job.applyUrl ?? job.jobUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby={ids.manual}
            // The employer's tab opens; the question waits here for the way back.
            onClick={() => setAsking(true)}
            // A middle click opens it in a tab behind: ask all the same.
            onAuxClick={(event) => {
              if (event.button === 1) setAsking(true);
            }}
            className={cn(buttonVariants(), 'no-underline')}
          >
            {text.manual}
            <span aria-hidden="true">↗</span>
            <span className="sr-only"> {copy.jobsPage.preview.newTab}</span>
          </a>
        )}
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
          {until !== undefined ? coolingLine(job, until, cooldown) : text.manualHint}
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

/** Why Manual apply is off, and until when (the day here). */
function coolingLine(job: JobSummary, until: string, cooldown: Cooldown | undefined): string {
  const values = { company: companyName(job), date: dayHere(until) ?? until };
  return cooldown
    ? fill(text.cooling, {
        ...values,
        applications: plural(text.applications, cooldown.limit),
        days: plural(text.days, cooldown.days),
      })
    : fill(text.coolingShort, values);
}
