import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils.ts';

/**
 * Placeholder shapes for a region waiting for its first data (#17), the prototype's
 * `.skeleton-block` (round 7, R10-1). It takes the region's final size, so nothing jumps when the
 * data arrives: `rows` sets how many lines, list rows or cards it stands for. A calm highlight
 * sweeps across once every golden second (1618ms); under reduced motion it stands still. Forced
 * colours draw a dashed outline instead. It is decorative (`aria-hidden`): the region around it
 * is `aria-busy` and says what is loading (QueryRegion does both).
 */
const skeletonVariants = cva(
  [
    'relative block w-full overflow-hidden bg-no-repeat',
    // The highlight: a soft band of surface white crossing the shapes.
    "after:absolute after:inset-0 after:animate-skeleton-sweep after:bg-[linear-gradient(100deg,transparent_30%,var(--color-surface)_50%,transparent_70%)] after:bg-size-[200%_100%] after:bg-no-repeat after:content-['']",
    'motion-reduce:after:animate-none',
    'forced-colors:border forced-colors:border-dashed forced-colors:border-[GrayText] forced-colors:bg-[Canvas] forced-colors:after:hidden',
  ],
  {
    variants: {
      kind: {
        /** One rounded block: a panel, an image, anything without a clear shape. */
        block:
          'min-h-[calc(var(--skeleton-rows)*63px-8px)] rounded-[15px] bg-[linear-gradient(var(--color-paper-deep),var(--color-paper-deep))] after:rounded-[inherit]',
        /** Lines of text: 13px bars, 8px apart. */
        lines:
          'min-h-[calc(var(--skeleton-rows)*21px-8px)] rounded-[4px] bg-[repeating-linear-gradient(var(--color-paper-deep)_0_13px,transparent_13px_21px)]',
        /** List rows: 55px, 8px apart. */
        rows: 'min-h-[calc(var(--skeleton-rows)*63px-8px)] rounded-[11px] bg-[repeating-linear-gradient(var(--color-paper-deep)_0_55px,transparent_55px_63px)]',
        /** Card tiles: 144px, 13px apart. */
        cards:
          'min-h-[calc(var(--skeleton-rows)*157px-13px)] rounded-[15px] bg-[repeating-linear-gradient(var(--color-paper-deep)_0_144px,transparent_144px_157px)]',
        /** A bar chart: bars on a baseline. */
        chart:
          'min-h-40 bg-[linear-gradient(var(--color-line-soft),var(--color-line-soft)),repeating-linear-gradient(90deg,var(--color-paper-deep)_0_21px,transparent_21px_34px)] bg-position-[0_100%,0_100%] bg-size-[100%_1px,100%_62%]',
      },
    },
    defaultVariants: { kind: 'block' },
  },
);

export type SkeletonKind = NonNullable<VariantProps<typeof skeletonVariants>['kind']>;

function Skeleton({
  kind,
  rows = 3,
  className,
  style,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> &
  VariantProps<typeof skeletonVariants> & {
    /** How many lines, rows or cards it stands for (1–48; the chart ignores it). */
    rows?: number;
  }) {
  const count = Math.max(1, Math.min(48, Math.round(rows) || 1));
  return (
    <div
      data-slot="skeleton"
      data-kind={kind ?? 'block'}
      aria-hidden="true"
      className={cn(skeletonVariants({ kind, className }))}
      style={{ '--skeleton-rows': count, ...style } as React.CSSProperties}
      {...props}
    />
  );
}

export { Skeleton };
