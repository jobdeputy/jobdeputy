import type { ReactNode } from 'react';
import { copy } from '@/copy/index.ts';
import { cn } from '@/lib/utils.ts';
import { PencilShape } from './panda.tsx';

/**
 * Each step's tool, as the deputy holds it: pencil, magnifier, approved page. One per entry in
 * copy.landing.steps.items, in order (test/StoryStrip.test.tsx checks the counts match).
 */
export const STEP_TOOLS: readonly ReactNode[] = [
  <PencilShape key="pencil" transform="translate(13.52 33.84) scale(0.63)" />,
  <g key="magnifier" transform="translate(8.11 42.36) scale(0.55)">
    <path
      className="stroke-blue"
      d="M3 -4L20 -26"
      fill="none"
      strokeWidth="11"
      strokeLinecap="round"
    />
    <circle
      className="fill-blue-soft stroke-blue"
      cx="34"
      cy="-43"
      r="22"
      fillOpacity="0.52"
      strokeWidth="8"
    />
    <path
      className="stroke-paper"
      d="M23 -48Q31 -57 41 -51"
      fill="none"
      strokeWidth="4"
      strokeLinecap="round"
      opacity="0.85"
    />
  </g>,
  <g key="approval" transform="translate(13.43 45.89) scale(0.38)">
    <rect
      className="fill-paper stroke-line-strong"
      x="-12"
      y="-110"
      width="80"
      height="104"
      rx="13"
      strokeWidth="2.5"
    />
    <path
      className="stroke-ink-soft"
      d="M2 -92H36"
      fill="none"
      strokeWidth="6"
      strokeLinecap="round"
    />
    <path
      className="stroke-quiet"
      d="M2 -78H52M2 -66H34"
      fill="none"
      strokeWidth="4.5"
      strokeLinecap="round"
      strokeOpacity="0.7"
    />
    <circle className="fill-green-soft stroke-green" cx="28" cy="-34" r="17" strokeWidth="4" />
    <path
      className="stroke-green-ink"
      d="M19.5 -34.5L25.5 -28.5L37 -40"
      fill="none"
      strokeWidth="4.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </g>,
];

/**
 * The three steps under the deputy: "1 Set it up › 2 It finds › 3 It applies". The step the
 * stage shows is current (filled bar, green number). One column on phones, a row from tablets up.
 */
export function StoryStrip({ current, className }: { current: number; className?: string }) {
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
            key={step.title}
            aria-current={isCurrent ? 'step' : undefined}
            className="relative grid grid-cols-[36px_minmax(0,1fr)] items-start gap-x-2.5 px-2 pt-2 pb-[17px] before:absolute before:inset-x-2 before:bottom-[5px] before:h-[3px] before:rounded-full before:bg-muted-foreground aria-[current=step]:after:absolute aria-[current=step]:after:inset-x-2 aria-[current=step]:after:bottom-1 aria-[current=step]:after:h-[5px] aria-[current=step]:after:rounded-full aria-[current=step]:after:bg-green-ink"
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
              <span className="flex items-center gap-1.5 text-[15px] leading-[1.3] font-bold">
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
              <span className="text-[13px] leading-[1.35] text-pretty text-muted-foreground">
                {step.line}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
