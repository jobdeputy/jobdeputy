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
      <p className="story-stage-speech rounded-[18px_18px_18px_5px] border border-line bg-white/88 px-2.5 py-2 text-center font-display text-xs leading-[1.3] text-balance italic shadow-[0_15px_38px_color-mix(in_oklab,var(--color-ink)_10%,transparent)] backdrop-blur-[13px] md:px-3.5 md:py-3 md:text-[clamp(0.875rem,1.1vw,1rem)]">
        {stage.speech}
      </p>
      <p className="absolute top-2 right-0 z-9 inline-flex min-h-7 items-center gap-[7px] rounded-full border border-line-soft bg-surface px-[11px] text-xs font-[650] tracking-[0.03em] whitespace-nowrap text-muted-foreground shadow-panel backdrop-blur-[13px] before:size-[7px] before:rounded-full before:bg-green before:shadow-[0_0_0_4px_var(--color-green-wash)]">
        {stage.status}
      </p>
    </div>
  );
}
