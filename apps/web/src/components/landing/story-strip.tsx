import { type ReactNode, useEffect, useRef } from 'react';
import { ApprovalShape, MagnifierShape, PencilShape } from '@/components/deputy/panda.tsx';
import { type Copy, copy, type OnePer } from '@/copy/index.ts';
import { cn } from '@/lib/utils.ts';
import type { StepProgress } from './use-story.ts';

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
  progress,
  duration,
  run,
  onSelect,
  onStepEnd,
  className,
}: {
  current: number;
  /** The current step's bar: filling over `duration` ms as it plays, held, waiting, or full. */
  progress: StepProgress;
  duration: number;
  /** Changes when the bar must start over (the story resumed after waiting). */
  run: number;
  onSelect: (index: number) => void;
  /** The current step's bar has filled: the story's clock (useStory). */
  onStepEnd: () => void;
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
              data-progress={isCurrent ? progress : undefined}
              onClick={() => onSelect(index)}
              className="relative grid w-full cursor-pointer rounded-[13px] text-start transition-colors duration-[180ms] hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid motion-reduce:transition-none grid-cols-[36px_minmax(0,1fr)] items-start gap-x-2.5 px-2 pt-2 pb-[17px] before:absolute before:inset-x-2 before:bottom-[5px] before:h-[3px] before:rounded-full before:bg-muted-foreground"
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
              {isCurrent && (
                <StepBar
                  // A new run (after waiting for someone to watch) starts the bar over.
                  key={run}
                  progress={progress}
                  duration={duration}
                  onFilled={onStepEnd}
                />
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** The bar's fill, from empty to full; it is linear, so how full it is says how far the step is. */
const FILL: Keyframe[] = [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }];

/**
 * The current step's bar: it fills over the step's time while the story plays, stops part-way on
 * Pause (Play goes on from there), waits empty while nobody can watch, and shows full otherwise
 * (a chosen step, the story's end, reduced motion). When it has filled while playing it tells the
 * story, which moves on: it is the story's clock. Driven through the Web Animations API (play,
 * pause, a finish event), which every engine keeps the same; CSS play states did not (Linux WebKit
 * restarted a resumed bar).
 */
function StepBar({
  progress,
  duration,
  onFilled,
}: {
  progress: StepProgress;
  duration: number;
  onFilled: () => void;
}) {
  const bar = useRef<HTMLSpanElement>(null);
  const fill = useRef<Animation | null>(null);
  // The latest state, for the finish event (set up once per bar).
  const state = useRef({ progress, onFilled });
  state.current = { progress, onFilled };
  // Filled just as the story was paused (the end landed a frame after Pause): it cannot fill
  // again, so Play moves the story on at once instead.
  const filledWhileHeld = useRef(false);

  useEffect(() => {
    const element = bar.current;
    if (!element?.animate) return;
    const animation = element.animate(FILL, { duration, easing: 'linear', fill: 'both' });
    // Cancelling rejects `finished`; that is expected here, not an error.
    animation.finished?.catch(() => {});
    animation.pause();
    animation.onfinish = () => {
      if (state.current.progress === 'filling') state.current.onFilled();
      else if (state.current.progress === 'held') filledWhileHeld.current = true;
    };
    fill.current = animation;
    return () => {
      animation.onfinish = null;
      animation.cancel();
      fill.current = null;
    };
  }, [duration]);

  useEffect(() => {
    const animation = fill.current;
    if (progress !== 'held' && filledWhileHeld.current) {
      // Only straight from that hold to Play; a hold that ended any other way forgets it.
      filledWhileHeld.current = false;
      if (progress === 'filling') {
        onFilled();
        return;
      }
    }
    if (!animation) return;
    if (progress === 'filling') {
      animation.play();
    } else if (progress === 'held') {
      animation.pause();
    } else {
      // Full or waiting: shown still at that end.
      animation.pause();
      animation.currentTime = progress === 'full' ? duration : 0;
    }
  }, [progress, duration, onFilled]);

  return (
    <span
      ref={bar}
      aria-hidden="true"
      data-bar={progress}
      className="absolute inset-x-2 bottom-1 h-[5px] origin-left rounded-full bg-green-ink"
    />
  );
}
