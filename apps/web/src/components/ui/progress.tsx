import { Progress as ProgressPrimitive } from 'radix-ui';
import { useEffect, useId, useState } from 'react';
import { copy, fill } from '@/copy/index.ts';
import { cn } from '@/lib/utils.ts';

const percentFormat = new Intl.NumberFormat(copy.locale, {
  style: 'percent',
  maximumFractionDigits: 0,
});

/** How long a new status region stays empty, so screen readers register it before its text. */
const LIVE_REGION_SETTLE_MS = 100;

/**
 * The value as a whole percentage in the copy's locale ("40%"). Rounded down, so 99.6 reads 99%:
 * "100%" only when the work is done.
 */
function formatPercent(value: number) {
  return percentFormat.format(Math.floor(value) / 100);
}

/** The last quarter a value (0–100) has reached: 0, 25, 50, 75, or 100. */
function milestone(value: number) {
  return Math.floor(value / 25) * 25;
}

/**
 * A progress bar with its words beside it (#17): an upload, or any step with a known percentage
 * (`value` 0–100), or work of unknown length (`value={null}`). The look is the prototype's meter
 * (round 7 `.meter-group`): the label and the value stay visible above an 8px track, and the fill
 * eases to each new value in 618ms. Radix gives it role="progressbar" and its aria-value*
 * attributes. As the value passes each quarter, a polite status line reads out the label and
 * percentage; the bar never takes focus. Without a value, a segment sweeps the track, or under
 * reduced motion still stripes fill it.
 */
function Progress({
  label,
  value,
  className,
}: {
  /** What is in progress, shown above the bar and naming it: "Uploading résumé". */
  label: string;
  /** 0 to 100, or null while the length of the work is unknown. */
  value: number | null;
  className?: string;
}) {
  const labelId = useId();
  // Out-of-range values (a rounding overshoot) are held to the track. A value that is not a number
  // (an upload whose total size is unknown divides by 0) means the length is unknown.
  const current =
    value === null || !Number.isFinite(value) ? null : Math.min(100, Math.max(0, value));
  // The status region mounts empty and takes its text a moment later: screen readers skip text a
  // live region is born with, so a bar that first appears at 30% would never say 25%. A timer, not
  // just an effect: after a click, React runs effects in the same task, before the browser has
  // told assistive technology the region exists.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), LIVE_REGION_SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);
  const announcement = mounted ? milestoneAnnouncement(label, current) : '';

  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-2',
        className,
      )}
    >
      <p id={labelId} className="m-0 text-[0.8125rem]/[1.35] font-[680] text-ink">
        {label}
      </p>
      {current !== null && (
        <p
          aria-hidden="true"
          className="m-0 text-end text-xs/[1.4] text-muted-foreground tabular-nums"
        >
          {formatPercent(current)}
        </p>
      )}
      <ProgressPrimitive.Root
        data-slot="progress"
        aria-labelledby={labelId}
        value={current}
        getValueLabel={(current) => formatPercent(current)}
        className="relative block h-2 min-w-14 flex-[1_0_100%] overflow-hidden rounded-full bg-paper-deep inset-ring inset-ring-line forced-colors:border forced-colors:border-[CanvasText]"
      >
        <ProgressPrimitive.Indicator
          // A new element when the length becomes known (or unknown): otherwise the fill would ease
          // from wherever the sweep was, sliding in from the side.
          key={current === null ? 'unknown' : 'known'}
          className={cn(
            // green-ink, not green: 4.5:1 on the track (WCAG 1.4.11 asks 3:1), close to the
            // prototype's darker meter green.
            'block h-full rounded-full bg-green-ink forced-color-adjust-none forced-colors:bg-[Highlight]',
            current !== null
              ? 'w-full transition-transform duration-618 ease-settle motion-reduce:transition-none'
              : // Unknown length under reduced motion: still diagonal stripes across the track, so
                // it reads as working, neither empty nor full.
                'w-1/3 animate-progress-sweep motion-reduce:w-full motion-reduce:animate-none motion-reduce:bg-transparent motion-reduce:bg-[repeating-linear-gradient(-45deg,var(--color-green-ink)_0_0.25rem,transparent_0.25rem_0.5rem)] motion-reduce:forced-colors:bg-transparent motion-reduce:forced-colors:bg-[repeating-linear-gradient(-45deg,Highlight_0_0.25rem,transparent_0.25rem_0.5rem)]',
          )}
          style={current !== null ? { transform: `translateX(-${100 - current}%)` } : undefined}
        />
      </ProgressPrimitive.Root>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

/**
 * The status line for the last quarter the value reached, or nothing before the first quarter. It
 * changes only when a new quarter is reached, so each crossing is read out once; a value that drops
 * back (a new upload starting) clears it, and the next crossing is read out again.
 */
function milestoneAnnouncement(label: string, value: number | null) {
  const reached = value === null ? 0 : milestone(value);
  return reached === 0
    ? ''
    : fill(copy.loading.progressMilestone, { label, percent: formatPercent(reached) });
}

export { Progress };
