import { useEffect, useRef } from 'react';
import { DeputySpeech, DeputyStatus } from '@/components/deputy/deputy-speech.tsx';
import { Panda } from '@/components/deputy/panda.tsx';
import { Button } from '@/components/ui/button.tsx';
import { copy, fill } from '@/copy/index.ts';

/** The set-up's steps after the welcome (#33): you, your target roles, your résumé. */
const STEPS = 3;

/**
 * The guided set-up after the first sign-in (#33), from the round 7 prototype's onboarding: the
 * deputy beside the current step, inside the signed-in layout (whose header shows `StepProgress`).
 * This is the welcome: who is signed in and the Region their account lives in. Its title takes
 * focus on arrival, so the change of page is announced.
 */
export function SetUp({
  email,
  onStart,
}: {
  email: string;
  /** "Let’s start": on to the first step. */
  onStart: () => void;
}) {
  const text = copy.setUp;
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  return (
    <div className="mx-auto grid w-full max-w-[1120px] content-start gap-8 px-[17px] py-8 sm:px-[clamp(21px,4vw,55px)] md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:items-start md:py-14">
      {/* Phones: a small deputy beside what he says, so the step stays near the top. From md
            up: the deputy large, centred over his words, beside the step. */}
      <div className="flex items-center gap-4 md:sticky md:top-8 md:grid md:justify-items-center md:gap-3">
        <Panda pose="setup" className="w-[92px] shrink-0 md:w-[220px]" />
        <div className="grid justify-items-start gap-2 md:justify-items-center">
          <DeputySpeech className="px-4 py-2.5 text-lg">{text.speech}</DeputySpeech>
          <DeputyStatus>{text.status}</DeputyStatus>
        </div>
      </div>
      <section
        aria-labelledby="set-up-title"
        className="grid gap-6 rounded-[24px] border border-line bg-surface-strong p-[21px] shadow-panel sm:p-8"
      >
        <div className="grid gap-2">
          <p className="m-0 flex items-center gap-2 text-xs font-[750] tracking-[0.12em] uppercase before:block before:h-[3px] before:w-[13px] before:rounded-full before:bg-green">
            {text.eyebrow}
          </p>
          <h1
            id="set-up-title"
            tabIndex={-1}
            ref={title}
            className="m-0 font-display text-[clamp(2.25rem,8vw,3rem)] leading-none font-medium tracking-[-0.05em] text-balance outline-none"
          >
            {text.title}
          </h1>
          <p className="m-0 text-[0.9375rem] text-muted-foreground">{text.intro}</p>
        </div>
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
      </section>
    </div>
  );
}

/** One fact about the account: what it is, its value, and a pill where it is fixed. */
function Fact({ label, value, pill }: { label: string; value: string; pill?: string }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[15px] border border-line-soft bg-surface px-4 py-3">
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-xs font-[650] text-muted-foreground">{label}</span>
        <strong className="min-w-0 text-[0.9375rem] font-[650] wrap-anywhere">{value}</strong>
      </span>
      {pill && (
        <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-[650] text-muted-foreground">
          {pill}
        </span>
      )}
    </li>
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
