import type { ReactNode } from 'react';
import { DeputySpeech, DeputyStatus } from '@/components/deputy/deputy-speech.tsx';
import { Panda } from '@/components/deputy/panda.tsx';
import { HeaderAside } from '@/components/header-aside.tsx';
import { Button } from '@/components/ui/button.tsx';
import { copy, fill } from '@/copy/index.ts';
import type { Profile } from '@/lib/api/profile.ts';
import { Fact, StepIntro } from './parts.tsx';
import { StepYou } from './step-you.tsx';

/** The set-up's steps after the welcome (#33): you, your target roles, your résumé. */
const STEPS = 3;

/** Where the set-up is: the welcome, or one of its steps (each saved as you go). */
export type SetUpStep = 'welcome' | 'you';

/**
 * The guided set-up after the first sign-in (#33), from the round 7 prototype's onboarding: the
 * deputy beside the current step, inside the signed-in layout (its header shows the step bar).
 * Each step saves through the API as the person goes, then moves on with `onNext`.
 */
export function SetUp({
  email,
  step,
  profile,
  onNext,
  onBack,
}: {
  email: string;
  step: SetUpStep;
  /** What is saved so far (the API's version-0 defaults before the first step saves). */
  profile: Profile;
  onNext: () => void;
  onBack: () => void;
}) {
  if (step === 'you') {
    return (
      <SetUpFrame current={0} speech={copy.setUp.you.speech}>
        <StepYou profile={profile} onSaved={onNext} onBack={onBack} />
      </SetUpFrame>
    );
  }
  return (
    <SetUpFrame current={null} speech={copy.setUp.speech}>
      <Welcome email={email} onStart={onNext} />
    </SetUpFrame>
  );
}

/**
 * Every step's frame: the step bar in the header, the deputy and what he says, and the step's
 * card. On phones the deputy sits small beside his words, so the step stays near the top; from md
 * up he stands large, centred over them, beside the step.
 */
function SetUpFrame({
  current,
  speech,
  children,
}: {
  /** The step (0-based), or null on the welcome. */
  current: number | null;
  speech: string;
  children: ReactNode;
}) {
  return (
    <div className="grid content-start gap-8 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:items-start">
      <HeaderAside>
        <StepProgress current={current} />
      </HeaderAside>
      <div className="flex items-center gap-4 md:sticky md:top-8 md:grid md:justify-items-center md:gap-3">
        <Panda pose="setup" className="w-[92px] shrink-0 md:w-[220px]" />
        <div className="grid justify-items-start gap-2 md:justify-items-center">
          <DeputySpeech className="px-4 py-2.5 text-lg">{speech}</DeputySpeech>
          <DeputyStatus>{copy.setUp.status}</DeputyStatus>
        </div>
      </div>
      <section
        aria-labelledby="set-up-title"
        className="grid gap-6 rounded-[24px] border border-line bg-surface-strong p-[21px] shadow-panel sm:p-8"
      >
        {children}
      </section>
    </div>
  );
}

/** The welcome: who is signed in and the Region their account lives in. */
function Welcome({ email, onStart }: { email: string; onStart: () => void }) {
  const text = copy.setUp;
  return (
    <>
      <StepIntro eyebrow={text.eyebrow} title={text.title} intro={text.intro} />
      <div className="grid gap-3">
        <h2 id="set-up-account" className="m-0 text-lg font-[700] tracking-[-0.02em]">
          {text.accountTitle}
        </h2>
        <ul aria-labelledby="set-up-account" className="m-0 grid list-none gap-2 p-0">
          <Fact label={text.signedInAs} value={email} />
          <Fact label={text.homeRegion} value={text.region} pill={text.locked} />
        </ul>
        <p className="m-0 text-sm text-muted-foreground">{text.regionNote}</p>
      </div>
      <Button size="lg" className="justify-self-start" onClick={onStart}>
        {text.start}
      </Button>
    </>
  );
}

/**
 * Where the set-up is: a bar per step, the steps done and the current one filled, and the words
 * that say it ("3 short steps" on the welcome, before any step; "Step 2 of 3" during them). The
 * bar is decorative; the words are what is read.
 */
export function StepProgress({ current }: { current: number | null }) {
  const text = copy.setUp;
  return (
    <div className="flex items-center gap-2.5">
      <p className="m-0 text-xs font-[650] text-muted-foreground">
        {current === null
          ? text.progress
          : fill(text.step, { current: String(current + 1), total: String(STEPS) })}
      </p>
      <ol aria-hidden="true" className="m-0 flex list-none gap-1 p-0">
        {Array.from({ length: STEPS }, (_, step) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed number of bars, one per step.
            key={step}
            className={
              current !== null && step <= current
                ? 'h-1.5 w-6 rounded-full bg-green'
                : 'h-1.5 w-6 rounded-full bg-line'
            }
          />
        ))}
      </ol>
    </div>
  );
}
