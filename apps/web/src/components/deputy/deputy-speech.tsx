import type * as React from 'react';
import { cn } from '@/lib/utils.ts';

/**
 * What the deputy says: the prototype's speech bubble (round 7), a frosted card with its
 * bottom-left corner tucked toward him. Shared by the landing story and DeputyWorking.
 */
export function DeputySpeech({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      className={cn(
        'm-0 rounded-[18px_18px_18px_5px] border border-line bg-white/88 font-display leading-[1.3] text-balance italic shadow-[0_15px_38px_color-mix(in_oklab,var(--color-ink)_10%,transparent)] backdrop-blur-[13px]',
        className,
      )}
      {...props}
    />
  );
}

/**
 * The deputy's status pill: what he is doing, beside a dot. Pass `dot` to replace the steady green
 * dot (DeputyWorking passes a turning ring). Shared by the landing story and DeputyWorking.
 */
export function DeputyStatus({
  className,
  dot,
  children,
  ...props
}: React.ComponentProps<'p'> & { dot?: React.ReactNode }) {
  return (
    <p
      className={cn(
        'm-0 inline-flex min-h-7 items-center gap-[7px] rounded-full border border-line-soft bg-surface px-[11px] text-xs font-[650] tracking-[0.03em] whitespace-nowrap text-muted-foreground shadow-panel backdrop-blur-[13px]',
        className,
      )}
      {...props}
    >
      {dot ?? (
        <span
          aria-hidden="true"
          className="size-[7px] shrink-0 rounded-full bg-green shadow-[0_0_0_4px_var(--color-green-wash)]"
        />
      )}
      {children}
    </p>
  );
}
