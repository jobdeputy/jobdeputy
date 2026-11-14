import { Panda } from '@/components/deputy/panda.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { copy } from '@/copy/index.ts';
import { useDelayedPending, useLongWait } from '@/lib/use-delayed-pending.ts';
import { cn } from '@/lib/utils.ts';

/**
 * The deputy at work on something long (#17): a crawl, a relevance run, a tailoring. The panda
 * holds the hourglass (the prototype's pending state), the status pill's dot turns, and he says
 * his line. `step` is what the job reports it is doing now. It times like every loading state:
 * nothing for 300 ms, then at least 500 ms. After 8 s it adds "Still working…", or, for a job
 * that runs on the server (`background`), that it carries on if the user leaves. The screen swaps
 * it for the job's result when the job ends.
 *
 * The pill, the step and the long-wait line sit in one polite status region, so each is read out
 * as it appears, without taking focus; the panda is decorative.
 */
export function DeputyWorking({
  active,
  status,
  speech,
  step,
  background = false,
  longWaitAfter,
  className,
}: {
  /** True while the job is queued or running. */
  active: boolean;
  /** The pill: what the deputy is doing ("Searching"). */
  status: string;
  /** His line ("On it."). */
  speech: string;
  /** What the job reports it is doing now ("Reading page 3 of 12"). */
  step?: string;
  /** A job that runs on the server: after 8 s, say the user can leave. */
  background?: boolean;
  /** When the wait counts as long; 8 s. The gallery shows the long state at once. */
  longWaitAfter?: number;
  className?: string;
}) {
  const shown = useDelayedPending(active);
  const long = useLongWait(active, longWaitAfter);

  // The status region is always there, empty until the deputy shows: screen readers skip the
  // text a live region is born with, so it must exist before its first words.
  return (
    <div
      data-slot="deputy-working"
      data-shown={shown || undefined}
      data-long={(shown && long) || undefined}
      className={cn(shown && 'flex items-center gap-4', className)}
    >
      {shown && <Panda pose="pending" className="size-28 shrink-0" />}
      <div className={cn(shown && 'grid min-w-0 justify-items-start gap-2')}>
        {shown && (
          <p className="m-0 rounded-[18px_18px_18px_5px] border border-line bg-white/88 px-3 py-2 font-display text-sm leading-[1.3] italic shadow-[0_15px_38px_color-mix(in_oklab,var(--color-ink)_10%,transparent)]">
            {speech}
          </p>
        )}
        <div role="status" className="grid justify-items-start gap-1">
          {shown && (
            <>
              <p className="m-0 inline-flex min-h-7 items-center gap-[7px] rounded-full border border-line-soft bg-surface px-[11px] text-xs font-[650] tracking-[0.03em] text-muted-foreground shadow-panel">
                <Spinner className="size-2.5 text-green" />
                {status}
              </p>
              {step && <p className="m-0 text-sm text-foreground">{step}</p>}
              {long && (
                <p className="m-0 text-sm text-muted-foreground">
                  {background ? copy.loading.background : copy.loading.stillWorking}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
