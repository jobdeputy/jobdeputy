import { useEffect, useState } from 'react';
import { copy, fill } from '../copy.ts';
import { DevTag } from '../dev-tag.tsx';
import type { Outcome } from './run.ts';

const text = copy.panel;

// The popup's button styles (src/popup.tsx), from the same tokens.
const primary =
  'inline-flex w-full cursor-pointer items-center justify-center rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-[translate,background-color] duration-180 ease-settle hover:-translate-y-px hover:bg-ink-soft focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0 motion-reduce:transition-none';
const quiet =
  'cursor-pointer rounded-xs bg-transparent p-0 text-sm font-[650] text-accent-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring';

/**
 * #54 PR C: the panel on a Greenhouse application form. One button fills the form; then it says
 * what it filled, which résumé it attached, and lists what it left for the person (outlined on
 * the page), required first. It never submits: the last line says so.
 */
export function Panel({
  fillForm,
  goTo,
  watchProgress,
  embedded = false,
}: {
  fillForm: () => Promise<Outcome>;
  /** Follows the form's progress after a fill (the person answering); returns a stop. */
  watchProgress?: (onChange: (now: Progress) => void) => () => void;
  /** Scrolls to a field left for the person and focuses it. */
  goTo: (id: string) => void;
  /** Inside a company site's frame: shown above the form, not pinned to the corner. */
  embedded?: boolean;
}) {
  const [shown, setShown] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function run() {
    setBusy(true);
    try {
      setOutcome(await fillForm());
    } catch {
      setOutcome({ ok: false, reason: 'failed' });
    } finally {
      setBusy(false);
    }
  }

  const place = embedded ? 'mx-auto my-4' : 'fixed right-4 bottom-4 z-[2147483647]';
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

  return (
    <section
      aria-labelledby="jobdeputy-title"
      aria-busy={busy}
      className={`${place} grid w-[min(340px,calc(100vw-2rem))] gap-3 rounded-[18px] border border-border bg-paper p-4 font-text text-ink shadow-control`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2
            id="jobdeputy-title"
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

      {!outcome?.ok && <p className="m-0 text-sm text-muted-foreground">{text.line}</p>}
      {outcome && !outcome.ok && (
        <p role="alert" className="m-0 text-sm text-destructive">
          {text[outcome.reason === 'signed-out' ? 'signedOut' : outcome.reason]}
        </p>
      )}
      {outcome?.ok && (
        <Summary outcome={outcome} goTo={goTo} {...(watchProgress ? { watchProgress } : {})} />
      )}

      {outcome?.ok ? (
        <button
          type="button"
          className={`${quiet} justify-self-start`}
          disabled={busy}
          onClick={() => void run()}
        >
          {busy ? text.filling : text.again}
        </button>
      ) : (
        <button type="button" className={primary} disabled={busy} onClick={() => void run()}>
          {busy ? text.filling : text.fill}
        </button>
      )}
      <p role="status" className="sr-only">
        {busy ? text.filling : ''}
      </p>
    </section>
  );
}

type Progress = { total: number; answered: number };

function Summary({
  outcome,
  goTo,
  watchProgress,
}: {
  outcome: Extract<Outcome, { ok: true }>;
  goTo: (id: string) => void;
  watchProgress?: (onChange: (now: Progress) => void) => () => void;
}) {
  const { report } = outcome;
  // The count as of the fill, then kept true as the person answers the rest.
  const [now, setNow] = useState<Progress>({ total: report.total, answered: report.answered });
  useEffect(() => {
    setNow({ total: report.total, answered: report.answered });
    return watchProgress?.(setNow);
  }, [report, watchProgress]);
  // Never more filled than answered (a page can clear a field it took).
  const count = Math.min(report.filled.length, now.answered);
  const required = report.left.filter((field) => field.required);
  const optional = report.left.length - required.length;
  const notes = [
    // Nothing to say when the person's own file was there, or the form asks for none.
    outcome.resume === 'kept'
      ? null
      : outcome.resume
        ? text.resume[outcome.resume]
        : outcome.unread.includes('resume')
          ? null
          : text.resume.none,
    outcome.coverLetter ? text.coverLetter : null,
    ...outcome.unread.map((part) => text.unread[part]),
  ].filter((note): note is string => Boolean(note));
  return (
    <div className="grid gap-3" role="status">
      <div className="grid gap-1.5">
        <p className="m-0 text-sm font-[650]">
          {fill(text.progress, { answered: String(now.answered), total: String(now.total) })}
        </p>
        {/* Only with questions to count (a bar's top must be above its bottom). */}
        {now.total > 0 && (
          <div
            role="progressbar"
            aria-label={text.progressLabel}
            aria-valuemin={0}
            aria-valuemax={now.total}
            aria-valuenow={now.answered}
            className="h-1.5 overflow-hidden rounded-full bg-surface-strong"
          >
            <div
              className="h-full rounded-full bg-green transition-[width] duration-300 ease-settle motion-reduce:transition-none"
              style={{
                width: `${Math.round((now.answered / now.total) * 100)}%`,
              }}
            />
          </div>
        )}
        <p className="m-0 text-sm text-muted-foreground">
          {count === 0
            ? text.filledNone
            : count === 1
              ? text.filledOne
              : fill(text.filled, { count: String(count) })}
        </p>
      </div>
      {notes.length > 0 && (
        <ul className="m-0 grid list-none gap-1 p-0 text-sm text-muted-foreground">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {required.length > 0 && (
        <section
          aria-labelledby="jobdeputy-left"
          className="grid gap-1.5 rounded-[13px] border border-border bg-card p-3"
        >
          <h3
            id="jobdeputy-left"
            className="m-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
          >
            {text.leftHeading} ({required.length})
          </h3>
          <p className="m-0 text-xs text-muted-foreground">{text.leftNote}</p>
          <ul className="m-0 grid max-h-48 list-none gap-1 overflow-y-auto p-0">
            {required.map((field) => (
              <li key={field.id}>
                <button
                  type="button"
                  className="w-full cursor-pointer rounded-md bg-transparent px-1 py-0.5 text-left text-sm text-ink hover:bg-surface-strong focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => goTo(field.id)}
                >
                  {field.label || field.id}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {optional > 0 && (
        <p className="m-0 text-xs text-muted-foreground">
          {optional === 1
            ? text.optionalEmptyOne
            : fill(text.optionalEmpty, { count: String(optional) })}
        </p>
      )}
      <p className="m-0 text-sm font-[650]">{text.review}</p>
    </div>
  );
}
