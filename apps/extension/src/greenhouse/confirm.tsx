import { type MouseEvent, useCallback, useEffect, useState } from 'react';
import { copy, fill } from '../copy.ts';
import { DevTag } from '../dev-tag.tsx';
import type { Application } from '../record.ts';
import { primary, quiet } from './styles.ts';

const text = copy.confirm;

/** When a cooldown ends, as the person reads dates (their own time zone). */
export function untilText(until: string): string | null {
  const date = new Date(until);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

/** What the panel says for a state that ends the question. */
function line(application: Application): string {
  switch (application.state) {
    case 'ask':
      return application.companyName
        ? fill(text.ask, { title: application.title, company: application.companyName })
        : fill(text.askNoCompany, { title: application.title });
    case 'saved':
      return text.saved;
    case 'moved-on':
      return text.movedOn;
    case 'not-listed':
      return text.notListed;
    case 'cooling-down': {
      const until = application.until ? untilText(application.until) : null;
      return until ? fill(text.coolingDown, { until }) : text.coolingDownNoDate;
    }
    case 'signed-out':
      return text.signedOut;
    case 'offline':
      return text.offline;
    case 'failed':
    case 'unconfigured':
      return text.failed;
  }
}

/**
 * #54 PR D (decision 0020): on Greenhouse's confirmation page, "Mark as applied?" for a job in the
 * person's JobDeputy list at stage New. One click records it; any other answer says why there's
 * nothing to record. Hidden with ×, or Not now.
 */
export function ConfirmPanel({
  read,
  record,
  trusted = (event) => event.nativeEvent.isTrusted,
}: {
  /** Is there an application to record (null: the worker failed)? */
  read: () => Promise<Application | null>;
  record: () => Promise<Application | null>;
  /**
   * Whether a click on Mark as applied came from the person. The page's own scripts can reach
   * the panel (its shadow root is open), and must never record an application.
   */
  trusted?: (event: MouseEvent<HTMLButtonElement>) => boolean;
}) {
  const [shown, setShown] = useState(true);
  const [busy, setBusy] = useState(false);
  const [application, setApplication] = useState<Application | null>(null);
  /** The last step that failed, to try again: the read, or the record. */
  const [failedStep, setFailedStep] = useState<'read' | 'record'>('read');

  const step = useCallback(async (which: 'read' | 'record', run: typeof read) => {
    setBusy(true);
    setFailedStep(which);
    try {
      setApplication((await run()) ?? { state: 'failed' });
    } catch {
      setApplication({ state: 'failed' });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void step('read', read);
  }, [read, step]);

  /** Records only on the person's own click (Mark as applied, or Try again after a record). */
  const recordOn = (event: MouseEvent<HTMLButtonElement>) => {
    if (trusted(event)) void step('record', record);
  };

  // A build that can't sign in has nothing to say here, not even the small button.
  if (application?.state === 'unconfigured') return null;
  const place = 'fixed right-4 bottom-4 z-[2147483647]';
  if (!shown) {
    return (
      <button
        type="button"
        className={`${place} cursor-pointer rounded-full border border-border bg-card px-4 py-2 font-text text-sm font-semibold text-ink shadow-control focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring`}
        onClick={() => setShown(true)}
      >
        {text.show}
      </button>
    );
  }

  const state = application?.state;
  const problem = state === 'offline' || state === 'failed';
  return (
    <section
      aria-labelledby="jobdeputy-confirm-title"
      aria-busy={busy}
      className={`${place} grid w-[min(340px,calc(100vw-2rem))] gap-3 rounded-[18px] border border-border bg-paper p-4 font-text text-ink shadow-control`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2
            id="jobdeputy-confirm-title"
            className="m-0 font-display text-xl leading-none font-medium tracking-[-0.03em]"
          >
            {text.title}
          </h2>
          <DevTag />
        </div>
        <button
          type="button"
          aria-label={text.hide}
          className="-m-1 cursor-pointer rounded-full bg-transparent p-1 text-lg leading-none text-muted-foreground hover:text-ink focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => setShown(false)}
        >
          ×
        </button>
      </div>

      {!application ? (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {text.checking}
        </p>
      ) : (
        <p
          role={problem ? 'alert' : 'status'}
          className={`m-0 text-sm ${problem ? 'text-destructive' : state === 'saved' || state === 'ask' ? 'text-ink' : 'text-muted-foreground'} ${state === 'saved' ? 'font-[650]' : ''}`}
        >
          {line(application)}
        </p>
      )}

      {state === 'ask' && (
        <div className="grid gap-2">
          <button
            type="button"
            className={primary}
            disabled={busy}
            onClick={(event) => recordOn(event)}
          >
            {busy ? text.marking : text.mark}
          </button>
          <button
            type="button"
            className={`${quiet} justify-self-center`}
            onClick={() => setShown(false)}
          >
            {text.notNow}
          </button>
        </div>
      )}
      {(problem || state === 'signed-out') && (
        <button
          type="button"
          className={`${quiet} justify-self-start`}
          disabled={busy}
          onClick={(event) => (failedStep === 'read' ? void step('read', read) : recordOn(event))}
        >
          {text.retry}
        </button>
      )}
    </section>
  );
}
