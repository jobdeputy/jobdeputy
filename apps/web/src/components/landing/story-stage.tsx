import type { ReactNode } from 'react';
import { DeputySpeech, DeputyStatus } from '@/components/deputy/deputy-speech.tsx';
import { Panda, type PandaPose } from '@/components/deputy/panda.tsx';
import { type Copy, copy, type OnePer } from '@/copy/index.ts';
import { cn } from '@/lib/utils.ts';

/**
 * The pose for each step of the story, in order. Typed to the steps in the copy, so a language
 * with a different number of steps fails to compile.
 */
const SCENES: OnePer<Copy['landing']['steps']['items'], PandaPose> = ['setup', 'search', 'apply'];

/**
 * The deputy at work on the story's current step (`index`): his pose and tool, his line, his
 * status, and the step's props (the setup card for "Set it up"). Decorative: the step strip and
 * the hero copy say the same in text, so all of it is hidden from screen readers, except the
 * story's controls (`controls`), which sit at its bottom left. Layout: src/styles/story-stage.css.
 */
export function StoryStage({
  index,
  controls,
  className,
}: {
  index: number;
  controls?: ReactNode;
  className?: string;
}) {
  const { stage, steps } = copy.landing;
  const step = steps.items[index] ?? steps.items[0];
  const scene = SCENES[index] ?? 'setup';
  return (
    <div className={cn('story-stage', className)} data-scene={scene}>
      <div className="story-stage-halo" aria-hidden="true" />
      <div className="story-stage-props" aria-hidden="true">
        <div
          className={cn(
            'transition-opacity duration-[380ms] ease-settle motion-reduce:transition-none',
            scene === 'setup' ? 'opacity-100' : 'opacity-0',
          )}
        >
          <div className="absolute top-[15%] left-[7%] grid h-[182px] w-[186px] -rotate-4 content-start gap-3 rounded-[15px] border border-line bg-surface-strong px-[17px] pt-[17px] pb-[13px] shadow-[0_14px_28px_color-mix(in_oklab,var(--color-ink)_10%,transparent)] lg:left-[3%]">
            <strong className="mb-0.5 block text-[0.625rem] tracking-[0.08em] uppercase">
              {stage.setupCardTitle}
            </strong>
            {stage.setupRows.map((row, index) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed-length list; rows may repeat in a translation.
                key={index}
                className="flex items-center gap-2.5 text-sm leading-tight font-[650]"
              >
                <span className="relative block size-[22px] shrink-0 rounded-full border-2 border-green bg-green-soft after:absolute after:top-[3px] after:left-[6px] after:h-[9px] after:w-[5px] after:rotate-45 after:border-r-[2.5px] after:border-b-[2.5px] after:border-green-ink" />
                {row}
              </span>
            ))}
          </div>
        </div>
      </div>
      <Panda className="story-stage-art" pose={scene} />
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
