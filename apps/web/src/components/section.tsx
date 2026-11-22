import type { ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils.ts';

/**
 * A page's section card (the round 7 prototype's `.task-surface`): its icon, its title (an h2,
 * `${id}-title`, which names the section) and a line under it, then its content. `aside` sits at
 * the end of the title row (under it on a narrow card); `headingRef` makes the title focusable, for
 * a page that moves focus to it (the Résumés page, after a delete).
 */
export function Section({
  id,
  icon,
  title,
  line,
  aside,
  headingRef,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  line: string;
  aside?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="@container min-w-0 rounded-[34px] border border-line-soft bg-surface p-[21px] shadow-panel sm:p-[34px]"
    >
      <div
        className={cn(
          'grid grid-cols-[44px_minmax(0,1fr)] items-start gap-[21px]',
          aside && 'gap-y-3 @lg:grid-cols-[44px_minmax(0,1fr)_auto]',
        )}
      >
        <span
          aria-hidden="true"
          className="grid size-11 place-items-center rounded-full bg-paper-deep text-ink-soft"
        >
          {icon}
        </span>
        <div className="grid gap-1">
          <h2
            id={`${id}-title`}
            ref={headingRef}
            tabIndex={headingRef ? -1 : undefined}
            className="m-0 text-xl font-[700] tracking-[-0.02em] outline-none"
          >
            {title}
          </h2>
          <p className="m-0 text-sm text-muted-foreground">{line}</p>
        </div>
        {aside && <div className="col-start-2 @lg:col-start-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}
