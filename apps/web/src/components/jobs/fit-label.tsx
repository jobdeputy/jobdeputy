import { copy } from '@/copy/index.ts';
import type { Fit } from '@/lib/api/companies.ts';
import { cn } from '@/lib/utils.ts';

/** Each fit's square, in the tokens' tones (the prototype's tone label). */
const TONES: Record<Fit, string> = {
  strong: 'before:bg-green',
  good: 'before:bg-blue',
  stretch: 'before:bg-quiet',
  unscored: 'before:border before:border-line-strong before:bg-transparent',
};

/**
 * How well a job fits (#49), the prototype's tone label: the words, with a coloured square that
 * repeats them (never the colour alone). Shared by the list's rows and the job's preview.
 */
export function FitLabel({ fit, className }: { fit: Fit; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[0.8125rem] font-[650] whitespace-nowrap text-ink-soft before:size-2.5 before:shrink-0 before:rounded-[3px] before:content-[""]',
        TONES[fit],
        className,
      )}
    >
      {copy.jobsPage.companies.fit[fit]}
    </span>
  );
}
