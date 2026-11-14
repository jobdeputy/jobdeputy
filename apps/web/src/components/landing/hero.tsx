import { Fragment } from 'react';
import { copy } from '@/copy/index.ts';
import { AuthButton, type AuthControl } from './auth-drawer.tsx';
import { StoryControls } from './story-controls.tsx';
import { StoryStage } from './story-stage.tsx';
import { StoryStrip } from './story-strip.tsx';
import { useStory } from './use-story.ts';

/**
 * The landing hero (round 7 `.story-panel`): the promise and the two ways in, the deputy at
 * work, and the three steps. One column up to laptops; from `lg` the copy and the stage sit side
 * by side. The page shell (App.tsx) makes the hero fill the screen under the header, whatever the
 * header's height; the hero grows rather than clips when text is enlarged.
 */
export function Hero({ auth }: { auth: AuthControl }) {
  const { landing } = copy;
  const story = useStory();
  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_250px_auto] overflow-clip bg-[radial-gradient(circle_at_50%_45%,var(--color-surface-strong),transparent_58%),linear-gradient(145deg,var(--color-paper),var(--color-paper-deep))] p-[21px] sm:grid-rows-[auto_320px_auto] sm:content-center sm:px-[34px] sm:pt-[34px] md:grid-rows-[auto_400px_auto] lg:min-h-[600px] lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)_auto] lg:content-normal lg:gap-x-[clamp(32px,4vw,72px)] lg:px-[max(48px,calc((100vw-1280px)/2))] lg:pt-[clamp(28px,4vh,56px)] lg:pb-[clamp(20px,3vh,34px)] 2xl:px-[max(48px,calc((100vw-1480px)/2))]"
    >
      {/* Still, organic colour fields behind everything. */}
      <div
        aria-hidden="true"
        className="absolute top-[-34%] right-[-50%] -z-10 aspect-[1.28] w-[125vw] -rotate-11 rounded-[48%_52%_59%_41%/43%_38%_62%_57%] bg-orange-soft/54 blur-[1px] sm:top-[-140px] lg:top-[-31%] sm:right-[-10%] sm:w-[min(42vw,610px)]"
      />
      <div
        aria-hidden="true"
        className="absolute bottom-[-54%] left-[-64%] -z-10 aspect-[1.42] w-[145vw] rotate-8 rounded-[48%_52%_41%_59%/60%_38%_62%_40%] bg-blue-soft/50 blur-[1px] sm:bottom-[-160px] lg:bottom-[-38%] sm:left-[-18%] sm:w-[min(52vw,760px)]"
      />
      <div
        aria-hidden="true"
        className="absolute right-[-5%] bottom-[-5%] -z-10 aspect-square w-[60vw] -rotate-8 rounded-[51%_49%_58%_42%/44%_59%_41%_56%] bg-green-soft/35 blur-[1px] sm:right-[10%] sm:bottom-[2%] sm:w-[min(23vw,340px)]"
      />

      <div className="relative z-10 max-w-[580px] self-start lg:max-w-[660px] lg:self-center 2xl:max-w-[760px]">
        <p className="mb-2 text-xs font-[750] tracking-[0.12em] text-green-ink uppercase sm:mb-[13px] sm:text-[0.8125rem]">
          {landing.eyebrow}
        </p>
        <h1
          id="hero-title"
          className="font-display text-[clamp(2.25rem,9.4vw,2.5rem)] leading-[0.98] font-medium tracking-[-0.055em] text-balance sm:text-[clamp(2.5rem,7.5vw,3.625rem)] lg:text-[clamp(3rem,4.4vw,5rem)]"
        >
          {/* Each line stays whole; the space between them is where the title may break. */}
          {landing.titleLines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed two-line title; lines may repeat in a translation.
            <Fragment key={index}>
              {index > 0 && ' '}
              <span className="inline-block">{line}</span>
            </Fragment>
          ))}
        </h1>
        <p className="mt-2 text-[0.9375rem] leading-[1.4] tracking-[-0.02em] text-pretty text-muted-foreground sm:mt-[13px] sm:text-base lg:mt-[21px] lg:max-w-[34ch] lg:text-[clamp(1.125rem,1.35vw,1.3125rem)] lg:leading-normal">
          {landing.body}
        </p>
        <div className="mt-[26px] flex flex-wrap gap-3">
          <AuthButton control={auth} mode="sign-up" size="lg">
            {landing.getStarted}
          </AuthButton>
          <AuthButton control={auth} mode="sign-in" size="lg" variant="outline">
            {landing.signIn}
          </AuthButton>
        </div>
      </div>

      <StoryStage
        index={story.index}
        playing={story.playing}
        held={story.held}
        controls={
          <StoryControls
            index={story.index}
            mode={story.mode}
            announcement={story.announcement}
            onToggle={story.toggle}
            onGoTo={story.goTo}
          />
        }
        className="w-full max-w-[690px] justify-self-center lg:h-full lg:max-h-[860px] lg:max-w-none lg:self-center"
      />

      <StoryStrip
        current={story.index}
        onSelect={story.goTo}
        className="mt-[13px] w-full max-w-[690px] justify-self-center lg:col-span-2 lg:mt-[18px] lg:max-w-[1100px]"
      />
    </section>
  );
}
