import type { ReactNode } from 'react';
import { DeputySpeech, DeputyStatus } from '@/components/deputy/deputy-speech.tsx';
import { Panda, type PandaPose } from '@/components/deputy/panda.tsx';
import { type Copy, copy, type OnePer } from '@/copy/index.ts';
import { cn } from '@/lib/utils.ts';
import { StoryProps } from './story-props.tsx';

/**
 * The pose for each step of the story, in order. Typed to the steps in the copy, so a language
 * with a different number of steps fails to compile.
 */
const SCENES: OnePer<Copy['landing']['steps']['items'], PandaPose> = ['setup', 'search', 'apply'];

/**
 * The deputy at work on the story's current step (`index`): his pose and tool, his line, his
 * status, and the step's props (StoryProps). Decorative: the step strip and
 * the hero copy say the same in text, so all of it is hidden from screen readers, except the
 * story's controls (`controls`), which sit at its bottom left. Layout: src/styles/story-stage.css.
 */
export function StoryStage({
  index,
  alive = false,
  held = false,
  controls,
  className,
}: {
  index: number;
  /** The story is playing where someone can see it: the deputy breathes and blinks. */
  alive?: boolean;
  /** Paused by the Pause button: every flourish on the stage holds where it is (the breath, which
   *  stops with the story, eases back to the pose). */
  held?: boolean;
  controls?: ReactNode;
  className?: string;
}) {
  const { steps } = copy.landing;
  const step = steps.items[index] ?? steps.items[0];
  const scene = SCENES[index] ?? 'setup';
  return (
    <div
      // Held by Pause: every flourish stops where it is. The variant (class and attribute) beats
      // the animate-* utilities that would set them running.
      className={cn('story-stage data-held:**:[animation-play-state:paused]', className)}
      data-scene={scene}
      data-held={held || undefined}
    >
      <div className="story-stage-halo" aria-hidden="true" />
      <div className="story-stage-props" aria-hidden="true">
        <StoryProps scene={scene} />
      </div>
      <Panda className="story-stage-art" pose={scene} alive={alive} />
      <DeputySpeech
        aria-hidden="true"
        className="story-stage-speech px-2.5 py-2 text-center text-xs md:px-3.5 md:py-3 md:text-[clamp(0.875rem,1.1vw,1rem)]"
      >
        {step.speech}
      </DeputySpeech>
      <DeputyStatus aria-hidden="true" className="absolute top-2 right-0 z-9">
        {step.status}
      </DeputyStatus>
      {controls && <div className="absolute bottom-0 left-0 z-10">{controls}</div>}
    </div>
  );
}
