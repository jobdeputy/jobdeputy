import { Fragment } from 'react';
import { copy } from '@/copy/index.ts';
import { AuthButton, type AuthControl } from './auth-drawer.tsx';
import { StoryStage } from './story-stage.tsx';
import { StoryStrip } from './story-strip.tsx';

/**
 * The landing hero (round 7 `.story-panel`): the promise and the two ways in, the deputy at
 * work, and the three steps. One column up to laptops; from `lg` the copy and the stage sit side
 * by side and the hero fills the screen under the header (`--spacing(18)` is the header's h-18);
 * it grows rather than clips when text is enlarged.
 */
export function Hero({ auth }: { auth: AuthControl }) {
  const { landing } = copy;
  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate grid min-h-[calc(100dvh-(--spacing(18)))] grid-rows-[auto_250px_auto] overflow-clip bg-[radial-gradient(circle_at_50%_45%,var(--color-surface-strong),transparent_58%),linear-gradient(145deg,var(--color-paper),var(--color-paper-deep))] p-[21px] sm:grid-rows-[auto_320px_auto] sm:content-center sm:px-[34px] sm:pt-[34px] md:grid-rows-[auto_400px_auto] lg:min-h-[max(600px,calc(100dvh-(--spacing(18))))] lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)_auto] lg:content-normal lg:gap-x-[clamp(32px,4vw,72px)] lg:px-[max(48px,calc((100vw-1280px)/2))] lg:pt-[clamp(28px,4vh,56px)] lg:pb-[clamp(20px,3vh,34px)] 2xl:px-[max(48px,calc((100vw-1480px)/2))]"
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
        <p className="mb-2 text-xs font-[750] tracking-[0.12em] text-green-ink uppercase sm:mb-[13px] sm:text-[13px]">
          {landing.eyebrow}
        </p>
        <h1
          id="hero-title"
          className="font-display text-[clamp(36px,9.4vw,40px)] leading-[0.98] font-medium tracking-[-0.055em] text-balance sm:text-[clamp(40px,7.5vw,58px)] lg:text-[clamp(48px,4.4vw,80px)]"
        >
          {/* Each line stays whole; the space between them is where the title may break. */}
          {landing.titleLines.map((line, index) => (
            <Fragment key={line}>
              {index > 0 && ' '}
              <span className="inline-block">{line}</span>
            </Fragment>
          ))}
        </h1>
        <p className="mt-2 text-[15px] leading-[1.4] tracking-[-0.02em] text-pretty text-muted-foreground sm:mt-[13px] sm:text-base lg:mt-[21px] lg:max-w-[34ch] lg:text-[clamp(18px,1.35vw,21px)] lg:leading-normal">
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
        <p className="mt-3 text-[13px] leading-[1.4] font-medium text-muted-foreground">
          {landing.note}
        </p>
      </div>

      <StoryStage className="w-full max-w-[690px] justify-self-center lg:h-full lg:max-h-[860px] lg:max-w-none lg:self-center" />

      <StoryStrip
        current={0}
        className="mt-[13px] w-full max-w-[690px] justify-self-center lg:col-span-2 lg:mt-[18px] lg:max-w-[1100px]"
      />
    </section>
  );
}
