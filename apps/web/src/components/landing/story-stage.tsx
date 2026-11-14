import { DeputySpeech, DeputyStatus } from '@/components/deputy/deputy-speech.tsx';
import { Panda } from '@/components/deputy/panda.tsx';
import { copy } from '@/copy/index.ts';
import { cn } from '@/lib/utils.ts';

/**
 * The deputy at work on the first step, "Set it up": the panda with his pencil, the setup card he
 * has ticked off, his line, and a status pill. Decorative: the step strip and the hero copy say
 * the same in text, so the stage is hidden from screen readers. Layout: src/styles/story-stage.css.
 */
export function StoryStage({ className }: { className?: string }) {
  const { stage } = copy.landing;
  return (
    <div className={cn('story-stage', className)} aria-hidden="true">
      <div className="story-stage-halo" />
      <div className="story-stage-props">
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
      <Panda className="story-stage-art" />
      <DeputySpeech className="story-stage-speech px-2.5 py-2 text-center text-xs md:px-3.5 md:py-3 md:text-[clamp(0.875rem,1.1vw,1rem)]">
        {stage.speech}
      </DeputySpeech>
      <DeputyStatus className="absolute top-2 right-0 z-9">{stage.status}</DeputyStatus>
    </div>
  );
}
