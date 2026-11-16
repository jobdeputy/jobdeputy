import { useEffect, useState } from 'react';
import { DeputySpeech, DeputyStatus } from '@/components/deputy/deputy-speech.tsx';
import { Panda } from '@/components/deputy/panda.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { copy } from '@/copy/index.ts';
import { LIVE_REGION_BEAT_MS } from '@/lib/live-region.ts';
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
 * The pill, the step and the long-wait line are each a polite status region, so each is read out
 * on its own as it changes, without taking focus; the panda is decorative.
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
  // Live regions that change in the same moment can be read as one or not at all (VoiceOver), so
  // when the deputy shows, the step follows the pill a beat later and the long-wait line a beat
  // after that.
  const [beats, setBeats] = useState(0);
  useEffect(() => {
    if (!shown) {
      setBeats(0);
      return;
    }
    const stepTimer = setTimeout(() => setBeats(1), LIVE_REGION_BEAT_MS);
    const longTimer = setTimeout(() => setBeats(2), 2 * LIVE_REGION_BEAT_MS);
    return () => {
      clearTimeout(stepTimer);
      clearTimeout(longTimer);
    };
  }, [shown]);

  // The live regions are always there, empty until their line comes: screen readers skip the
  // text a live region is born with, and one that is display:none is not there at all, so an
  // empty one is visually hidden (sr-only), never hidden outright. One region per line, so a new
  // step is read on its own, not with the pill and the long-wait sentence again. Each line stands
  // on its own: the long-wait line does not repeat the status, which the pill right above it
  // says (repeating it would read a new status twice, or an old one).
  const longLine =
    shown && long && beats >= 2
      ? background
        ? copy.loading.background
        : copy.loading.stillWorking
      : '';
  const stepLine = shown && step && beats >= 1 ? step : '';
  return (
    <div
      data-slot="deputy-working"
      data-shown={shown || undefined}
      data-long={longLine ? true : undefined}
      className={cn('flex flex-wrap items-center gap-4', className)}
    >
      {shown && <Panda pose="pending" className="size-28 shrink-0" />}
      {/* Beside the panda while there is room (12rem); below it on a narrow screen or with large
          text, rather than squeezed into a sliver that pushes the page sideways. */}
      <div className="grid min-w-0 flex-1 basis-48 justify-items-start gap-2">
        {shown && <DeputySpeech className="px-3 py-2 text-sm">{speech}</DeputySpeech>}
        <div role="status">
          {shown && (
            <DeputyStatus
              className="whitespace-normal"
              dot={<Spinner className="size-2.5 text-green" />}
            >
              {status}
            </DeputyStatus>
          )}
        </div>
        <p role="status" className={cn('m-0 text-sm text-foreground', !stepLine && 'sr-only')}>
          {stepLine}
        </p>
        <p
          role="status"
          className={cn('m-0 text-sm text-muted-foreground', !longLine && 'sr-only')}
        >
          {longLine}
        </p>
      </div>
    </div>
  );
}
