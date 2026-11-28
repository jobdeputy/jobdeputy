import { greenhouseFormUrl } from '@jobdeputy/shared/extension';
import { useEffect, useId, useRef, useState } from 'react';
import { coolingUntil, momentHere } from '@/components/jobs/cooldown.ts';
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
  useJob,
} from '@/lib/api/jobs.ts';
import { type ExtensionState, useExtension, useExtensionLink } from '@/lib/extension.ts';
import { cn } from '@/lib/utils.ts';

const text = copy.matchesPage.apply;

/**
 * Applying, in Matches' job pane (#52 PR C, locked on the issue): **Manual apply** opens the
 * employer's application (its apply page, else the posting) in a new tab, and asks "Did you
 * apply on the employer site?" (the prototype's check): I applied marks the job applied, and it
 * leaves Matches (`onApplied`); Not yet puts the question away. **Auto apply** shows, unavailable,
 * until the browser extension (#54).
 *
 * #54 PR D (decision 0020): with the extension installed (one this cell trusts, `useExtension`),
 * **Auto apply** hands it the job and its Greenhouse form (built from the board and the posting's
 * ID, never the stored address); the extension opens it in a new tab and fills it in, and the
 * person submits. The same "Did you apply?" question then shows, and Matches is read again when
 * the page has the focus back (`onReturn`): a job the extension recorded leaves it. Auto apply is
 * unavailable, saying why, for a job that isn't on Greenhouse, while cooling down, and without
 * the extension; where the site has no extension yet it says Soon.
 *
 * The question takes the focus when it shows, so it is the first thing met on coming back from
 * the employer's tab. A job found changed elsewhere (409 `stage-changed`: applied in another
 * tab; it can only have moved on) or gone (404) leaves Matches (`onGone`). Any other failure is said below the
 * actions, and the list is read again (`onFailed`).
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
  onReturn,
}: {
  job: JobSummary;
  /** Matches' cooldown rule, to say it. */
  cooldown?: Cooldown;
  /** Saved: the job as the API has it now (applied). */
  onApplied: (job: JobSummary) => void;
  /** Not in Matches any more: applied to elsewhere, or taken down. */
  onGone: () => void;
  onFailed: () => void;
  /** Back on this page after Auto apply: Matches read again (the extension may have recorded it). */
  onReturn?: () => void;
}) {
  const api = useApi();
  const extension = useExtension();
  const link = useExtensionLink();
  // The full job (the pane reads it too): the posting's ID, for its Greenhouse form. Only for a
  // Greenhouse job, where the site has an extension to hand it to.
  const greenhouse = job.companyKey.startsWith('greenhouse:');
  const wantsForm =
    greenhouse && extension.data !== undefined && extension.data.state !== 'unsupported';
  const full = useJob(wantsForm ? job.jobId : null);
  const formUrl = greenhouseFormUrl(job.companyKey, full.data?.externalId);
  const [asking, setAsking] = useState(false);
  const [handing, setHanding] = useState(false);
  /** Auto apply opened the form: the page coming back into focus reads Matches again. */
  const [handedOff, setHandedOff] = useState(false);
  const [saving, setSaving] = useState(false);
  // What went wrong, and how many times (a new failure is a new alert, read out again).
  const [failure, setFailure] = useState<{
    words: string;
    count: number;
    /** A refusal for the cooldown: no longer true once it ends. */
    cooling: boolean;
  } | null>(null);
  const manual = useRef<HTMLAnchorElement>(null);
  const question = useRef<HTMLFieldSetElement>(null);
  const ids = { manual: useId(), auto: useId(), askLine: useId() };
  // The parent draws again when a cooldown ends (useRedrawAt), so this is always current.
  const until = coolingUntil(job);
  useEffect(() => {
    if (asking) question.current?.focus();
  }, [asking]);
  // Cooling down now while asking (the list read again): nothing to ask any more. Manual apply
  // is the same element, now unavailable: the focus, if the question had it, goes there. What
  // went wrong stays said (a refusal for the cooldown is why the question goes).
  useEffect(() => {
    if (until === undefined || !asking) return;
    const active = document.activeElement;
    const hadFocus =
      question.current?.contains(active) === true || active === null || active === document.body;
    setAsking(false);
    if (hadFocus) manual.current?.focus();
  }, [until, asking]);
  // The cooldown is over: its refusal is no longer true.
  useEffect(() => {
    if (until === undefined) setFailure((was) => (was?.cooling ? null : was));
  }, [until]);
  // Matches read again once, on coming back to this page after the handoff.
  const returned = useRef(onReturn);
  returned.current = onReturn;
  useEffect(() => {
    if (!handedOff) return;
    const back = () => {
      setHandedOff(false);
      returned.current?.();
    };
    window.addEventListener('focus', back);
    return () => window.removeEventListener('focus', back);
  }, [handedOff]);
  async function autoApply() {
    if (!formUrl) return;
    setHanding(true);
    setFailure(null);
    const answer = await link.autoApply(job.jobId, formUrl);
    setHanding(false);
    if (answer.ok || answer.reason === 'no-answer') {
      // Silent but reached: it may have opened the form, so ask as if it had (never twice).
      // Already back on this page (a slow answer): read Matches now; else when it comes back.
      if (document.hasFocus()) returned.current?.();
      else setHandedOff(true);
      ask();
      if (!answer.ok) {
        setFailure((was) => ({
          cooling: false,
          words: text.autoFailed.late,
          count: (was?.count ?? 0) + 1,
        }));
      }
      return;
    }
    // What the extension says now (signed out, gone).
    void extension.refetch();
    setFailure((was) => ({
      cooling: false,
      words:
        answer.reason === 'signed-out'
          ? text.autoFailed.signedOut
          : answer.reason === 'unreachable'
            ? text.autoFailed.noAnswer
            : text.autoFailed.cantOpen,
      count: (was?.count ?? 0) + 1,
    }));
  }
  function ask() {
    setAsking(true);
    // A save under way keeps its answer to come; otherwise a fresh question.
    if (!saving) setFailure(null);
  }
  async function applied() {
    setSaving(true);
    // A new try: what the last one said no longer applies.
    setFailure(null);
    try {
      const saved = await setStage(api, job.jobId, 'applied', 'new');
      onApplied(saved);
    } catch (error) {
      if (stageGone(error)) {
        onGone();
        return;
      }
      setSaving(false);
      setFailure((was) => ({
        cooling: coolingDown(error),
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
  /** Whether Auto apply can be pressed, and what it says. */
  const auto = autoState(
    extension.data,
    until !== undefined,
    formUrl,
    // Only a Greenhouse job waits for its posting's ID, or says it couldn't read it.
    greenhouse ? (full.isError ? 'failed' : full.isPending ? 'loading' : 'read') : 'other',
  );
  function notYet() {
    setAsking(false);
    setFailure(null);
    manual.current?.focus();
  }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {/*
         * One element in both states, so the focus stays on it when a cooldown starts or ends.
         * While cooling down it is unavailable, not disabled (no address: nothing opens): it can
         * still be reached, and says why and until when.
         */}
        <a
          ref={manual}
          {...(until === undefined
            ? {
                href: job.applyUrl ?? job.jobUrl,
                target: '_blank',
                rel: 'noopener noreferrer',
                // The employer's tab opens; the question waits here for the way back.
                onClick: ask,
                // A middle click opens it in a tab behind: ask all the same.
                onAuxClick: (event: React.MouseEvent) => {
                  if (event.button === 1) ask();
                },
              }
            : { role: 'link', tabIndex: 0, 'aria-disabled': true, 'data-unavailable': true })}
          aria-describedby={ids.manual}
          className={cn(buttonVariants(), 'no-underline')}
        >
          {text.manual}
          {until === undefined && (
            <>
              <span aria-hidden="true">↗</span>
              <span className="sr-only"> {copy.jobsPage.preview.newTab}</span>
            </>
          )}
        </a>
        {/* Unavailable, not disabled: it can still be reached, and says why. */}
        <Button
          variant="outline"
          {...(auto.available
            ? {
                pending: handing,
                pendingLabel: text.autoOpening,
                onClick: () => void autoApply(),
              }
            : { 'aria-disabled': true })}
          aria-describedby={ids.auto}
        >
          {text.auto}
          {auto.soon && (
            <span className="rounded-full bg-paper-deep px-2 py-0.5 text-[0.6875rem]/[1.3] font-[750] tracking-[0.08em] text-ink-soft uppercase">
              {text.soon}
            </span>
          )}
        </Button>
      </div>
      <div className="grid gap-1 text-sm text-muted-foreground">
        <p id={ids.manual} className="m-0">
          {until !== undefined ? coolingLine(job, until, cooldown) : text.manualHint}
        </p>
        <p id={ids.auto} className="m-0">
          {auto.hint}
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
          </fieldset>
        </div>
      )}
      {/*
       * Always there, so a failure is read out when it comes. Outside the question: a refusal for
       * the cooldown closes the question, and stays said until Manual apply is pressed again.
       */}
      <p
        key={failure?.count ?? 0}
        role="alert"
        className={failure ? 'm-0 text-sm font-[650] text-danger-ink' : 'sr-only'}
      >
        {failure?.words ?? ''}
      </p>
    </div>
  );
}

/** Why Manual apply is off, and until when (the day here). */
function coolingLine(job: JobSummary, until: string, cooldown: Cooldown | undefined): string {
  const values = { company: companyName(job), date: momentHere(until) };
  return cooldown
    ? fill(text.cooling, {
        ...values,
        applications: plural(text.applications, cooldown.limit),
        days: plural(text.days, cooldown.days),
      })
    : fill(text.coolingShort, values);
}

/** Auto apply: available, its words, and whether it says Soon (#54 PR D). */
function autoState(
  extension: ExtensionState | undefined,
  cooling: boolean,
  formUrl: string | null,
  /** A Greenhouse job's posting: being read, couldn't be, or read; `other`, not Greenhouse. */
  jobRead: 'loading' | 'failed' | 'read' | 'other',
): { available: boolean; hint: string; soon: boolean } {
  const off = (hint: string) => ({ available: false, hint, soon: false });
  if (!extension) return off(text.autoChecking);
  if (extension.state === 'unsupported')
    return { available: false, hint: text.autoHint, soon: true };
  if (cooling) return off(text.autoCooling);
  if (!formUrl) {
    return off(
      jobRead === 'loading'
        ? text.autoChecking
        : jobRead === 'failed'
          ? text.autoJobFailed
          : jobRead === 'read'
            ? text.autoNoForm
            : text.autoNotGreenhouse,
    );
  }
  if (extension.state === 'missing') return off(text.autoMissing);
  return {
    available: true,
    hint: extension.signedIn ? text.autoReady : text.autoSignIn,
    soon: false,
  };
}
