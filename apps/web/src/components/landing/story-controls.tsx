import { copy, fill } from '@/copy/index.ts';
import { cn } from '@/lib/utils.ts';
import type { StoryMode } from './use-story.ts';

const STEPS = copy.landing.steps.items;

const BUTTON =
  'grid size-11 cursor-pointer place-items-center rounded-full text-ink transition-colors duration-[180ms] hover:bg-paper aria-disabled:cursor-default aria-disabled:opacity-28 aria-disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid motion-reduce:transition-none';

/**
 * The story's controls (the prototype's `.story-controls`): back a step, play / pause / replay,
 * forward a step, in a frosted pill. The ends stay focusable (`aria-disabled`), so focus never
 * drops to the page; each arrow names the step it goes to. Moving announces the new step.
 */
export function StoryControls({
  index,
  mode,
  announcement,
  onToggle,
  onGoTo,
  className,
}: {
  index: number;
  mode: StoryMode;
  announcement: string;
  onToggle: () => void;
  onGoTo: (index: number) => void;
  className?: string;
}) {
  const { story } = copy.landing;
  const previous = STEPS[index - 1];
  const next = STEPS[index + 1];
  return (
    <>
      <fieldset
        className={cn(
          'm-0 inline-flex min-w-0 items-center gap-0.5 rounded-full border border-line-soft bg-surface p-[3px] shadow-panel backdrop-blur-[13px]',
          className,
        )}
      >
        <legend className="sr-only">{story.controls}</legend>
        <button
          type="button"
          className={cn(BUTTON, 'text-xl leading-none')}
          aria-disabled={previous ? undefined : true}
          aria-label={previous ? fill(story.previousTo, { title: previous.title }) : story.previous}
          onClick={() => previous && onGoTo(index - 1)}
        >
          <span aria-hidden="true">←</span>
        </button>
        <button type="button" className={BUTTON} data-mode={mode} onClick={onToggle}>
          <ToggleGlyph mode={mode} />
          <span className="sr-only">{story[mode]}</span>
        </button>
        <button
          type="button"
          className={cn(BUTTON, 'text-xl leading-none')}
          aria-disabled={next ? undefined : true}
          aria-label={next ? fill(story.nextTo, { title: next.title }) : story.next}
          onClick={() => next && onGoTo(index + 1)}
        >
          <span aria-hidden="true">→</span>
        </button>
      </fieldset>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </>
  );
}

/** Pause: two bars. Play and Advance: a triangle. Replay: a turning arrow. */
function ToggleGlyph({ mode }: { mode: StoryMode }) {
  if (mode === 'pause') {
    return (
      <span
        aria-hidden="true"
        className="h-2.5 w-2 border-x-[3px] border-current forced-colors:border-[CanvasText]"
      />
    );
  }
  if (mode === 'replay') {
    return (
      <span aria-hidden="true" className="text-lg leading-none">
        ↻
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="size-0 border-y-[6px] border-l-[9px] border-y-transparent border-l-current forced-colors:border-l-[CanvasText]"
    />
  );
}
