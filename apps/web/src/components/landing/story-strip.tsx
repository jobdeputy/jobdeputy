import type { ReactNode } from 'react';
import { ApprovalShape, MagnifierShape, PencilShape } from '@/components/deputy/panda.tsx';
import { type Copy, copy, type OnePer } from '@/copy/index.ts';
import { cn } from '@/lib/utils.ts';

/**
 * Each step's tool, as the deputy holds it: pencil, magnifier, approved page. Typed to the steps
 * in the copy, so a language with a different number of steps fails to compile.
 */
const STEP_TOOLS: OnePer<Copy['landing']['steps']['items'], ReactNode> = [
  <PencilShape key="pencil" transform="translate(13.52 33.84) scale(0.63)" />,
  <MagnifierShape key="magnifier" transform="translate(8.11 42.36) scale(0.55)" />,
  <ApprovalShape key="approval" transform="translate(13.43 45.89) scale(0.38)" />,
];

/**
 * The three steps under the deputy: "1 Set it up › 2 It finds › 3 It applies", the story's
 * chapters. The step the stage shows is current (filled bar, green number, `aria-current`). Each
 * is a button (a Tab stop, named by its number, title and line) that shows its chapter. One column
 * on phones, a row from tablets up.
 */
export function StoryStrip({
  current,
  onSelect,
  className,
}: {
  current: number;
  onSelect: (index: number) => void;
  className?: string;
}) {
  const { steps } = copy.landing;
  return (
    <ol
      aria-label={steps.label}
      className={cn('relative z-10 grid gap-1 md:grid-cols-3 md:gap-x-[21px]', className)}
    >
      {steps.items.map((step, index) => {
        const isCurrent = index === current;
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed-length list; titles may repeat in a translation.
            key={index}
            className="relative"
          >
            <button
              type="button"
              aria-current={isCurrent ? 'step' : undefined}
              onClick={() => onSelect(index)}
              className="relative grid w-full cursor-pointer rounded-[13px] text-start transition-colors duration-[180ms] hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid motion-reduce:transition-none grid-cols-[36px_minmax(0,1fr)] items-start gap-x-2.5 px-2 pt-2 pb-[17px] before:absolute before:inset-x-2 before:bottom-[5px] before:h-[3px] before:rounded-full before:bg-muted-foreground aria-[current=step]:after:absolute aria-[current=step]:after:inset-x-2 aria-[current=step]:after:bottom-1 aria-[current=step]:after:h-[5px] aria-[current=step]:after:rounded-full aria-[current=step]:after:bg-green-ink"
            >
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -start-[15px] top-4 hidden text-lg leading-none text-muted-foreground md:block"
                >
                  ›
                </span>
              )}
              <span
                className={cn(
                  'grid size-9 place-items-center rounded-full border',
                  isCurrent ? 'border-green bg-green-soft' : 'border-line bg-surface-strong',
                )}
              >
                <svg
                  viewBox="0 0 48 48"
                  className="block size-[26px]"
                  aria-hidden="true"
                  focusable="false"
                >
                  {STEP_TOOLS[index]}
                </svg>
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="flex items-center gap-1.5 text-[0.9375rem] leading-[1.3] font-bold">
                  <span
                    className={cn(
                      'inline-grid size-5 shrink-0 place-items-center rounded-full text-xs leading-none font-[750] tabular-nums',
                      isCurrent ? 'bg-green-ink text-white' : 'bg-paper-deep text-ink-soft',
                    )}
                  >
                    {index + 1}
                  </span>
                  {step.title}
                </span>
                <span className="text-[0.8125rem] leading-[1.35] text-pretty text-muted-foreground">
                  {step.line}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
